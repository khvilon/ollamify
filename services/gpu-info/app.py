import os
import time
from flask import Flask, jsonify

try:
    import pynvml
except Exception:  # pragma: no cover
    pynvml = None

app = Flask(__name__)


def _safe_int(value, default=None):
    try:
        return int(value)
    except Exception:
        return default


def _gpu_snapshot():
    if pynvml is None:
        return []

    try:
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        gpus = []

        for idx in range(count):
            h = pynvml.nvmlDeviceGetHandleByIndex(idx)

            name = pynvml.nvmlDeviceGetName(h)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")

            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)

            power_w = None
            try:
                power_w = pynvml.nvmlDeviceGetPowerUsage(h) / 1000.0
            except Exception:
                pass

            gpus.append(
                {
                    "index": idx,
                    "name": name,
                    "memory_total_mb": round(mem.total / (1024 * 1024)),
                    "memory_used_mb": round(mem.used / (1024 * 1024)),
                    "memory_free_mb": round(mem.free / (1024 * 1024)),
                    "utilization_gpu_percent": _safe_int(getattr(util, "gpu", None), 0),
                    "utilization_mem_percent": _safe_int(getattr(util, "memory", None), 0),
                    "temperature_c": _safe_int(temp, None),
                    "power_w": power_w,
                }
            )

        return gpus
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/gpus")
def gpus():
    return jsonify({"gpus": _gpu_snapshot(), "timestamp": int(time.time())})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8005"))
    app.run(host="0.0.0.0", port=port)

