"""Create an installable custom-node ZIP without local test data."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
destination = root / "dist" / "ComfyUI-Layout-Templates.zip"
destination.parent.mkdir(exist_ok=True)
files = [root / "__init__.py", root / "pyproject.toml", root / "README.md"]
files += sorted((root / "web").rglob("*.js"))
files += sorted((root / "examples").glob("*.json"))
files += [root / "docs" / "verification.md"]
with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, Path("ComfyUI-Layout-Templates") / path.relative_to(root))
print(destination)
