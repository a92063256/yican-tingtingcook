"""Vendor an offline bundle; Python is only needed when replacing the bundled content."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
archive = Path(sys.argv[1])
target = root / 'content/howtocook'
images = root / 'public/images'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def safe_file(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise ValueError('Invalid bundle path: ' + name)
    return path

with zipfile.ZipFile(archive) as source:
    manifest_bytes = source.read('manifest.json')
    manifest = json.loads(manifest_bytes)
    assert manifest['format'] == 'yican.howtocook.bundle' and manifest['schemaVersion'] == 1
    assert manifest['recipeCount'] == len(manifest['recipes']) == 369
    assert len({r['recipeId'] for r in manifest['recipes']}) == 369
    # Validate everything before writing the checked-in assets. Never execute bundle scripts.
    files = {'manifest.json': manifest_bytes,
             'licenses/HowToCook-LICENSE': source.read(manifest['source']['licenseFile'])}
    unique_images = {}
    for recipe in manifest['recipes']:
        assert recipe['recipeId'] == 'howtocook-' + digest(recipe['sourcePath'].encode())[:20]
        assert recipe['markdownFile'] == 'source/' + recipe['sourcePath']
        safe_file(recipe['markdownFile'])
        raw = source.read(recipe['markdownFile'])
        assert digest(raw) == recipe['markdownSha256']
        files[recipe['markdownFile']] = raw
        cover = recipe.get('cover')
        if not cover:
            continue
        assert re.fullmatch(r'images/howtocook-[a-f0-9]{20}\.webp', cover['file'])
        raw = source.read(cover['file'])
        assert digest(raw) == cover['sha256'] and len(raw) == cover['bytes']
        assert raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'
        unique_images['howtocook-' + cover['sha256'] + '.webp'] = raw
    assert len(unique_images) == 170
    target.mkdir(parents=True, exist_ok=True)
    images.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        path = target / str(safe_file(name))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    for name, raw in unique_images.items():
        (images / name).write_bytes(raw)
    (target / 'bundle.json').write_text(json.dumps({
        'archiveSha256': digest(archive.read_bytes()),
        'manifestSha256': digest(manifest_bytes),
        'licenseSha256': digest(files['licenses/HowToCook-LICENSE']),
        'recipeCount': len(manifest['recipes']),
        'coverCount': manifest['imageCount'],
        'uniqueImages': len(unique_images),
        'imageBytes': sum(map(len, unique_images.values()))
    }, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'recipes': len(manifest['recipes']), 'uniqueImages': len(unique_images),
                      'imageBytes': sum(map(len, unique_images.values()))}))
