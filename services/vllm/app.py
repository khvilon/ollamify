import json
import os
import shlex
import signal
import subprocess
import threading
import time
from urllib.parse import urlparse

import requests
from flask import Flask, Response, jsonify, request, stream_with_context


app = Flask(__name__)

PORT = int(os.environ.get("PORT", "8007"))
INNER_HOST = os.environ.get("VLLM_INNER_HOST", "127.0.0.1")
INNER_PORT = int(os.environ.get("VLLM_INNER_PORT", "8008"))
INNER_BASE_URL = f"http://{INNER_HOST}:{INNER_PORT}"
LOAD_TIMEOUT_SECONDS = int(os.environ.get("VLLM_LOAD_TIMEOUT_SECONDS", "1800"))
STOP_TIMEOUT_SECONDS = int(os.environ.get("VLLM_STOP_TIMEOUT_SECONDS", "10"))
KILL_TIMEOUT_SECONDS = int(os.environ.get("VLLM_KILL_TIMEOUT_SECONDS", "5"))
DEFAULT_ARGS = os.environ.get("VLLM_DEFAULT_ARGS", "--dtype auto --gpu-memory-utilization 0.55")
PROXY_TIMEOUT_SECONDS = float(os.environ.get("VLLM_PROXY_TIMEOUT_SECONDS", "0") or "0")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")

REQUIRE_GPU = os.environ.get("VLLM_REQUIRE_GPU", "1").lower() not in {"0", "false", "no"}
UNLOAD_OLLAMA_MODEL = os.environ.get("VLLM_UNLOAD_OLLAMA_MODEL", "1").lower() not in {"0", "false", "no"}

DEFAULT_MODEL_ALIASES = {
    "qwen3:4b": {
        "target": "Qwen/Qwen3-4B-AWQ",
        "extra_args": [
            "--max-model-len",
            "2048",
        ],
    },
    "qwen3:8b": {
        "target": "Qwen/Qwen3-8B-FP8",
        "extra_args": [
            "--max-model-len",
            "2048",
        ],
    },
    "LiquidAI/LFM2.5-8B-A1B": {
        "target": "LiquidAI/LFM2.5-8B-A1B",
        "extra_args": [
            "--max-model-len",
            "2048",
        ],
    },
    "qwen3.5:9b": {
        "target": "RedHatAI/Qwen3.5-9B-FP8-dynamic",
        "extra_args": [
            "--max-model-len",
            "4096",
            "--language-model-only",
        ],
    },
}

state_lock = threading.RLock()
process = None
status = {
    "state": "stopped",
    "current_model": None,
    "desired_model": None,
    "actual_model": None,
    "served_models": [],
    "pid": None,
    "started_at": None,
    "error": None,
    "inner_url": INNER_BASE_URL,
    "command": None,
}


def normalize_model(value):
    if not isinstance(value, str):
        return ""

    model = value.strip()
    if model.startswith("vllm/"):
        model = model[len("vllm/"):]

    parsed = urlparse(model)
    if parsed.scheme in {"http", "https"} and parsed.netloc == "huggingface.co":
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2:
            model = f"{parts[0]}/{parts[1]}"

    return model.strip("/")


def parse_args(value):
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return shlex.split(value)
    return []


def normalize_alias_entry(entry):
    if isinstance(entry, str):
        return {"target": normalize_model(entry), "extra_args": []}

    if not isinstance(entry, dict):
        return None

    target = normalize_model(entry.get("target") or entry.get("model") or entry.get("hf_model"))
    if not target:
        return None

    return {
        "target": target,
        "extra_args": parse_args(entry.get("extra_args") or entry.get("args") or []),
    }


def parse_model_aliases():
    aliases = {
        source: {
            "target": value["target"],
            "extra_args": list(value.get("extra_args", [])),
        }
        for source, value in DEFAULT_MODEL_ALIASES.items()
    }
    raw = os.environ.get("VLLM_MODEL_ALIASES", "").strip()
    if not raw:
        return aliases

    try:
        if raw.startswith("{"):
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("VLLM_MODEL_ALIASES JSON must be an object")
            for source, entry in data.items():
                source_model = normalize_model(source)
                alias_entry = normalize_alias_entry(entry)
                if source_model and alias_entry:
                    aliases[source_model] = alias_entry
        else:
            for item in raw.split(","):
                if "=" not in item:
                    continue
                source, target = item.split("=", 1)
                source_model = normalize_model(source)
                target_model = normalize_model(target)
                if source_model and target_model:
                    aliases[source_model] = {"target": target_model, "extra_args": []}
    except Exception as exc:
        print(f"[vllm-manager] failed to parse VLLM_MODEL_ALIASES: {exc}", flush=True)

    return aliases


def resolve_model_request(model, extra_args=None):
    served_model = normalize_model(model)
    if not served_model:
        return None

    aliases = parse_model_aliases()
    alias = aliases.get(served_model)
    actual_model = served_model
    resolved_extra_args = []

    if alias:
        actual_model = alias["target"]
        resolved_extra_args.extend(alias.get("extra_args", []))

    resolved_extra_args.extend(parse_args(extra_args))

    return {
        "served_model": served_model,
        "actual_model": actual_model,
        "extra_args": resolved_extra_args,
        "aliased": bool(alias),
    }


def get_gpu_blocker():
    if not REQUIRE_GPU:
        return None

    visible_devices = os.environ.get("NVIDIA_VISIBLE_DEVICES", "").strip().lower()
    if visible_devices in {"", "none", "void"}:
        return "vLLM requires an NVIDIA GPU, but no NVIDIA devices are exposed to the container."

    try:
        result = subprocess.run(
            ["nvidia-smi", "-L"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return None
        detail = (result.stderr or result.stdout or "").strip()
        return f"vLLM requires an NVIDIA GPU, but nvidia-smi did not report one. {detail}".strip()
    except FileNotFoundError:
        if os.path.exists("/dev/nvidia0") or os.path.exists("/dev/nvidiactl"):
            return None
        return "vLLM requires an NVIDIA GPU, but nvidia-smi is missing and no /dev/nvidia* device is visible."
    except Exception as exc:
        return f"vLLM requires an NVIDIA GPU, but GPU detection failed: {exc}"


def unload_ollama_model(model):
    if not UNLOAD_OLLAMA_MODEL or not model:
        return

    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": model,
                "prompt": "",
                "stream": False,
                "keep_alive": 0,
            },
            timeout=15,
        )
        if response.ok:
            print(f"[vllm-manager] requested Ollama unload for {model}", flush=True)
        else:
            print(
                f"[vllm-manager] Ollama unload for {model} returned {response.status_code}: {response.text[:300]}",
                flush=True,
            )
    except Exception as exc:
        print(f"[vllm-manager] failed to unload Ollama model {model}: {exc}", flush=True)


def build_command(actual_model, served_model, extra_args=None):
    args = [
        "vllm",
        "serve",
        actual_model,
        "--host",
        INNER_HOST,
        "--port",
        str(INNER_PORT),
        "--served-model-name",
        served_model,
    ]
    args.extend(parse_args(DEFAULT_ARGS))
    args.extend(parse_args(extra_args))
    return args


def get_models_from_vllm(timeout=2):
    response = requests.get(f"{INNER_BASE_URL}/v1/models", timeout=timeout)
    response.raise_for_status()
    data = response.json()
    models = data.get("data", [])
    return [item.get("id") for item in models if item.get("id")]


def refresh_process_state():
    global process
    with state_lock:
        proc = process
        if proc and proc.poll() is not None:
            exit_code = proc.returncode
            process = None
            if status["state"] not in {"stopped", "error"}:
                status.update({
                    "state": "error",
                    "pid": None,
                    "error": f"vLLM exited with code {exit_code}",
                })


def stop_current_locked():
    global process
    proc = process
    process = None
    if not proc or proc.poll() is not None:
        return

    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        proc.terminate()

    try:
        proc.wait(timeout=STOP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            proc.kill()
        try:
            proc.wait(timeout=KILL_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            pass


def wait_until_ready(expected_model, proc):
    deadline = time.time() + LOAD_TIMEOUT_SECONDS
    last_error = None

    while time.time() < deadline:
        with state_lock:
            if process is not proc:
                return

        if proc.poll() is not None:
            last_error = f"vLLM exited with code {proc.returncode}"
            break

        try:
            served_models = get_models_from_vllm()
            normalized_served_models = {normalize_model(model) for model in served_models}
            if normalize_model(expected_model) not in normalized_served_models:
                last_error = f"vLLM is ready, but expected model {expected_model} is not served"
                time.sleep(2)
                continue

            with state_lock:
                if process is proc:
                    status.update({
                        "state": "running",
                        "current_model": expected_model,
                        "served_models": served_models,
                        "pid": proc.pid,
                        "error": None,
                    })
            return
        except Exception as exc:
            last_error = str(exc)
            time.sleep(2)

    with state_lock:
        if process is proc:
            stop_current_locked()
            timeout_error = f"Timed out after {LOAD_TIMEOUT_SECONDS}s waiting for vLLM readiness"
            if last_error:
                timeout_error = f"{timeout_error}; last readiness error: {last_error}"
            status.update({
                "state": "error",
                "pid": None,
                "error": timeout_error,
            })


def start_model(model, extra_args=None):
    global process
    resolved = resolve_model_request(model, extra_args)
    if not resolved:
        return {"error": "model is required"}, 400

    gpu_blocker = get_gpu_blocker()
    if gpu_blocker:
        with state_lock:
            stop_current_locked()
            status.update({
                "state": "error",
                "current_model": None,
                "desired_model": resolved["served_model"],
                "actual_model": resolved["actual_model"],
                "served_models": [],
                "pid": None,
                "error": gpu_blocker,
                "command": None,
            })
            return current_status_locked(), 503

    with state_lock:
        refresh_process_state()
        if (
            process
            and process.poll() is None
            and status["state"] == "running"
            and status["current_model"] == resolved["served_model"]
            and status.get("actual_model") == resolved["actual_model"]
        ):
            return current_status_locked(), 200

        stop_current_locked()
        unload_ollama_model(resolved["served_model"])
        command = build_command(resolved["actual_model"], resolved["served_model"], resolved["extra_args"])
        print(f"[vllm-manager] starting: {' '.join(shlex.quote(part) for part in command)}", flush=True)
        process = subprocess.Popen(command, start_new_session=True)
        status.update({
            "state": "loading",
            "current_model": None,
            "desired_model": resolved["served_model"],
            "actual_model": resolved["actual_model"],
            "served_models": [],
            "pid": process.pid,
            "started_at": int(time.time()),
            "error": None,
            "command": command,
            "aliased": resolved["aliased"],
        })
        proc = process

    threading.Thread(target=wait_until_ready, args=(resolved["served_model"], proc), daemon=True).start()
    return current_status(), 202


def current_status_locked():
    refresh_process_state()
    if status["state"] == "running":
        try:
            status["served_models"] = get_models_from_vllm(timeout=1)
        except Exception:
            pass
    runtime_blocker = get_gpu_blocker()
    return {
        "available": runtime_blocker is None,
        "runtime_blocker": runtime_blocker,
        **status,
    }


def current_status():
    with state_lock:
        return current_status_locked()


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/status")
def get_status():
    return jsonify(current_status())


@app.post("/load")
def load_model():
    payload = request.get_json(silent=True) or {}
    result, status_code = start_model(payload.get("model"), payload.get("extra_args"))
    return jsonify(result), status_code


@app.post("/unload")
def unload_model():
    with state_lock:
        stop_current_locked()
        status.update({
            "state": "stopped",
            "current_model": None,
            "desired_model": None,
            "actual_model": None,
            "served_models": [],
            "pid": None,
            "error": None,
            "command": None,
            "aliased": False,
        })
        return jsonify(current_status_locked())


@app.route("/v1/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def proxy_v1(path):
    refresh_process_state()
    with state_lock:
        if status["state"] != "running":
            return jsonify({
                "error": {
                    "message": f"vLLM is not running (state={status['state']})",
                    "type": "service_unavailable",
                    "code": status.get("error"),
                }
            }), 503

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length"}
    }
    timeout = None if PROXY_TIMEOUT_SECONDS <= 0 else PROXY_TIMEOUT_SECONDS
    upstream = requests.request(
        request.method,
        f"{INNER_BASE_URL}/v1/{path}",
        headers=headers,
        params=request.args,
        data=request.get_data(),
        stream=True,
        timeout=timeout,
    )

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in {"content-encoding", "content-length", "transfer-encoding", "connection"}
    }

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(
        stream_with_context(generate()),
        status=upstream.status_code,
        headers=response_headers,
    )


def autostart():
    initial_model = normalize_model(os.environ.get("VLLM_MODEL", ""))
    if initial_model:
        result, status_code = start_model(initial_model, os.environ.get("VLLM_EXTRA_ARGS"))
        if status_code >= 400:
            print(f"[vllm-manager] autostart blocked: {result.get('error')}", flush=True)


if __name__ == "__main__":
    autostart()
    app.run(host="0.0.0.0", port=PORT, threaded=True)
