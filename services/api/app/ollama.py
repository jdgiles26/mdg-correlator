from __future__ import annotations

from typing import Any

import httpx

EMBED_MODEL_HINTS = (
    "embed",
    "embedding",
    "nomic-embed",
    "mxbai-embed",
    "bge",
    "e5",
    "snowflake-arctic-embed",
    "all-minilm",
)


def normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def is_embedding_model(name: str) -> bool:
    lowered = name.lower()
    return any(hint in lowered for hint in EMBED_MODEL_HINTS)


def is_selectable_model(model: dict[str, Any], name: str) -> bool:
    if not name or name.startswith("blobs:"):
        return False
    if model.get("remote_host") or name.endswith(":cloud"):
        return False
    return True


def fetch_tags(base_url: str, timeout_sec: float) -> list[dict[str, Any]]:
    normalized = normalize_base_url(base_url)
    with httpx.Client(timeout=timeout_sec) as client:
        response = client.get(f"{normalized}/api/tags")
        response.raise_for_status()
        payload = response.json()
    return payload.get("models", []) if isinstance(payload, dict) else []


def build_status(base_url: str, timeout_sec: float) -> dict[str, Any]:
    normalized = normalize_base_url(base_url)
    try:
        models = fetch_tags(normalized, timeout_sec)
    except Exception as exc:
        return {
            "base_url": normalized,
            "reachable": False,
            "error": str(exc),
            "models": [],
            "generate_models": [],
        }

    generate_models = []
    normalized_models = []
    for model in models:
        name = model.get("name") or model.get("model") or ""
        if not is_selectable_model(model, name):
            continue
        embedding = is_embedding_model(name)
        if not embedding:
            generate_models.append(name)
        normalized_models.append(
            {
                "name": name,
                "size": model.get("size"),
                "modified_at": model.get("modified_at"),
                "digest": model.get("digest"),
                "details": model.get("details") or {},
                "kind": "embedding" if embedding else "generate",
            }
        )

    return {
        "base_url": normalized,
        "reachable": True,
        "error": None,
        "models": normalized_models,
        "generate_models": generate_models,
    }


def ensure_generate_model_available(status: dict[str, Any], model_name: str | None) -> None:
    if not model_name:
        return
    available = set(status.get("generate_models") or [])
    if model_name not in available:
        raise ValueError(f"Ollama model '{model_name}' is not available locally.")


def generate(base_url: str, model: str, prompt: str, timeout_sec: float, system: str | None = None) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2},
    }
    if system:
        payload["system"] = system

    normalized = normalize_base_url(base_url)
    with httpx.Client(timeout=timeout_sec) as client:
        response = client.post(f"{normalized}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()

    answer = data.get("response")
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("Ollama returned an empty response.")
    return answer.strip()
