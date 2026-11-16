"""Check unitario: un capo fotografato su piu scatti deve finire nel prompt
come UNA sola fonte (un intervallo di reference), non come capi distinti.

`_compose_garments_block` e' una funzione pura, ma `import server` tirerebbe
dentro FastAPI/Mongo/SDK: qui dal sorgente si estraggono con `ast` solo la
tabella dei ruoli e la funzione, e si eseguono. Nessuna dipendenza, nessun
server acceso.

    python backend_test_multiphoto_prompt.py
"""
import ast
import os
from typing import List, Optional  # noqa: F401  (usati dagli annotation exec'ati)

_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "server.py")
_WANTED = {"GARMENT_ROLE", "_UPPER_CATS", "_LOWER_CATS", "_FULL_CATS", "_compose_garments_block"}

_tree = ast.parse(open(_SRC, encoding="utf-8").read())
_nodes = [
    n for n in _tree.body
    if (isinstance(n, ast.FunctionDef) and n.name in _WANTED)
    or (isinstance(n, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id in _WANTED for t in n.targets))
]
assert len(_nodes) == len(_WANTED), f"attesi {_WANTED}, trovati {len(_nodes)} nodi in server.py"
exec(compile(ast.Module(body=_nodes, type_ignores=[]), _SRC, "exec"), globals())


def test_outfit_su_piu_foto_e_una_fonte_sola():
    text, _ = _compose_garments_block(["outfit"], [3])
    assert "references #1-#3" in text
    assert "ONE SINGLE item" in text
    assert "do NOT treat them as separate garments" in text


def test_indici_restano_allineati_con_i_riferimenti():
    # giacca con 2 foto + pantaloni con 1 -> il pantalone e' il reference #3
    text, _ = _compose_garments_block(["giacca", "pantaloni"], [2, 1])
    assert "references #1-#2" in text
    assert "reference #3 = trousers" in text


def test_senza_conteggi_comportamento_invariato():
    text, shoes = _compose_garments_block(["scarpe"])
    assert "reference #1 = shoes" in text
    assert shoes is True


if __name__ == "__main__":
    test_outfit_su_piu_foto_e_una_fonte_sola()
    test_indici_restano_allineati_con_i_riferimenti()
    test_senza_conteggi_comportamento_invariato()
    print("ok")
