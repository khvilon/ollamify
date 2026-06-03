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
LOAD_TIMEOUT_SECONDS = int(os.environ.get("VLLM_LOAD_TIMEOUT_SECONDS", "600"))
DEFAULT_ARGS = os.environ.get("VLLM_DEFAULT_ARGS", "--dtype auto --gpu-memory-utilization 0.90")
PROXY_TIMEOUT_SECONDS = float(os.environ.get("VLLM_PROXY_TIMEOUT_SECONDS", "0") or "0")

state_lock = threading.RLock()
process = None
status = {
    "state": "stopped",
    "current_model": None,
    "desired_model": None,
    "served_models": [],
    "pid": None,
    "started_at": None,
    "error": None,
    "inner_url": INNER_BASE_URL,
}

REQUIRE_CPU_AVX = os.environ.get("VLLM_REQUIRE_CPU_AVX", "1").lower() not in {"0", "false", "no"}


def get_cpu_flags():
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as cpuinfo:
            for line in cpuinfo:
                if line.lower().startswith("flags"):
                    _, flags = line.split(":", 1)
                    return set(flags.strip().split())
    except Exception:
        return set()
    return set()


def get_runtime_blocker():
    flags = get_cpu_flags()
    if REQUIRE_CPU_AVX and not ({"avx", "avx2", "avx512f"} & flags):
        return (
            "vLLM cannot start in this container because the CPU exposed by the host/VM "
            "does not advertise AVX/AVX2/AVX512. The current vLLM image loads UCX code "
            "compiled with AVX support. Expose host CPU flags to the VM or use a vLLM "
            "image built for this CPU."
        )
    return None


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


def build_command(model, extra_args=None):
    args = [
        "vllm",
        "serve",
        model,
        "--host",
        INNER_HOST,
        "--port",
        str(INNER_PORT),
        "--served-model-name",
        model,
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
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            proc.kill()
        proc.wait(timeout=10)


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
            status.update({
                "state": "error",
                "pid": proc.pid if proc.poll() is None else None,
                "error": last_error or "Timed out waiting for vLLM readiness",
            })


def start_model(model, extra_args=None):
    global process
    normalized = normalize_model(model)
    if not normalized:
        return {"error": "model is required"}, 400

    runtime_blocker = get_runtime_blocker()
    if runtime_blocker:
        with state_lock:
            stop_current_locked()
            status.update({
                "state": "error",
                "current_model": None,
                "desired_model": normalized,
                "served_models": [],
                "pid": None,
                "error": runtime_blocker,
                "command": None,
            })
            return current_status_locked(), 503

    with state_lock:
        refresh_process_state()
        if (
            process
            and process.poll() is None
            and status["state"] == "running"
            and status["current_model"] == normalized
        ):
            return current_status_locked(), 200

        stop_current_locked()
        command = build_command(normalized, extra_args)
        print(f"[vllm-manager] starting: {' '.join(shlex.quote(part) for part in command)}", flush=True)
        process = subprocess.Popen(command, start_new_session=True)
        status.update({
            "state": "loading",
            "current_model": None,
            "desired_model": normalized,
            "served_models": [],
            "pid": process.pid,
            "started_at": int(time.time()),
            "error": None,
            "command": command,
        })
        proc = process

    threading.Thread(target=wait_until_ready, args=(normalized, proc), daemon=True).start()
    return current_status(), 202


def current_status_locked():
    refresh_process_state()
    if status["state"] == "running":
        try:
            status["served_models"] = get_models_from_vllm(timeout=1)
        except Exception:
            pass
    runtime_blocker = get_runtime_blocker()
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
            "served_models": [],
            "pid": None,
            "error": None,
            "command": None,
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
