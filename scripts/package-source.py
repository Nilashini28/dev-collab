from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import os

root = Path(__file__).resolve().parent.parent
output = root.parent / 'DevCollab-source.zip'
excluded = {'.git', '.local', '.env', 'node_modules', 'dist', 'generated', 'test-results', '.vercel', '.vite'}
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for base, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in excluded]
        for name in files:
            if name in excluded or (name.startswith('.env') and name != '.env.example'):
                continue
            path = Path(base) / name
            archive.write(path, path.relative_to(root))
print(output)
