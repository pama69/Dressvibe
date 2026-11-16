"""Check unitario di `_WebExport`, il mount che serve l'export Expo.

L'export usa `web.output: "static"`: una pagina .html per rotta. Qui si
verifica che `/upload` arrivi a `upload.html`, che una rotta sconosciuta
ricada su `index.html` e che un asset mancante resti un 404 vero. In piu'
che l'HTML esca con `Cache-Control: no-cache` e gli asset no.

`import server` tirerebbe dentro Mongo e gli SDK: la classe viene estratta
dal sorgente con `ast` ed eseguita da sola.

    python backend_test_web_routes.py
"""
import ast
import os
import tempfile

from fastapi.staticfiles import StaticFiles  # noqa: F401  (usata dalla classe)
from starlette.applications import Starlette
from starlette.exceptions import HTTPException as _StarletteHTTPException  # noqa: F401
from starlette.routing import Mount
from starlette.testclient import TestClient

_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "server.py")

_tree = ast.parse(open(_SRC, encoding="utf-8").read())
_cls = [n for n in _tree.body if isinstance(n, ast.ClassDef) and n.name == "_WebExport"]
assert len(_cls) == 1, "_WebExport non trovata al livello di modulo in server.py"
exec(compile(ast.Module(body=_cls, type_ignores=[]), _SRC, "exec"), globals())


def _client():
    d = tempfile.mkdtemp()
    for name, body in [
        ("index.html", "<!doctype html>home"),
        ("upload.html", "<!doctype html>upload"),
        ("bundle.abc123.js", "console.log(1)"),
    ]:
        open(os.path.join(d, name), "w").write(body)
    # Montato dentro un'app, come in produzione: serve il middleware delle
    # eccezioni perche' un 404 diventi una risposta e non un'eccezione.
    app = Starlette(routes=[Mount("/", _WebExport(directory=d, html=True))])  # noqa: F821
    return TestClient(app)


def test_rotta_senza_estensione_trova_la_pagina():
    r = _client().get("/upload")
    assert r.status_code == 200, r.status_code
    assert "upload" in r.text


def test_rotta_sconosciuta_ricade_sulla_home():
    # Il router client-side risolve poi l'URL (not-found incluso).
    r = _client().get("/pippo")
    assert r.status_code == 200
    assert "home" in r.text


def test_asset_mancante_resta_404():
    r = _client().get("/manca.js")
    assert r.status_code == 404, r.status_code


def test_html_non_cacheabile_asset_si():
    c = _client()
    assert c.get("/upload").headers.get("cache-control") == "no-cache"
    assert c.get("/bundle.abc123.js").headers.get("cache-control") is None


if __name__ == "__main__":
    test_rotta_senza_estensione_trova_la_pagina()
    test_rotta_sconosciuta_ricade_sulla_home()
    test_asset_mancante_resta_404()
    test_html_non_cacheabile_asset_si()
    print("ok")
