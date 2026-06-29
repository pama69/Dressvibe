"""Entrypoint di avvio per Railway/Docker.

Legge la porta da $PORT a runtime (default 8000). Essendo Python a leggere
l'env, funziona anche se Railway esegue il comando in "exec form" senza shell
(dove "$PORT" non verrebbe espanso).
"""
import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
