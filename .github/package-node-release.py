#!/usr/bin/env python3
import hashlib
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SOURCE = "124ea75875fb12373869ce4f95c8cd09334bb558"
CONFIG = {
    "linux": ("nexus-linux-x64", "nexus", ".tar.gz"),
    "macos": ("nexus-darwin-x64", "nexus", ".tar.gz"),
    "windows": ("nexus-win32-x64.exe", "nexus.exe", ".zip"),
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main(platform, run):
    input_name, executable, extension = CONFIG[platform]
    name = f"nexus-node-5.1.7-rc6-build1-{platform}-x86_64"
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        stage = Path(temp) / name
        stage.mkdir()
        binary = stage / executable
        shutil.copyfile(ROOT / "node-binary" / input_name, binary)
        binary.chmod(0o755)
        shutil.copyfile(ROOT / ".github/node-release-readme.txt", stage / "README.txt")
        shutil.copyfile(ROOT / "node-source" / "config" / "nexus.conf.windows-localhost-mining", stage / "nexus.conf.example")
        licenses = stage / "licenses"
        licenses.mkdir()
        for file in sorted((ROOT / "assets/misc/licenses").glob("*.txt")):
            if file.name != "embedded-cores.txt":
                shutil.copyfile(file, licenses / file.name)
        (stage / "BUILD-INFO.txt").write_text(
            "Nexus LLL-TAO 5.1.7-rc6 build 1\n"
            f"Platform: {platform} x86_64\n"
            f"Source: https://github.com/NamecoinGithub/LLL-TAO/tree/{SOURCE}\n"
            f"Build workflow: https://github.com/NamecoinGithub/NexusInterface/actions/runs/{run}\n"
            "Build scripts: https://github.com/NamecoinGithub/NexusInterface/tree/42f199390d214ccd6152604aa2d769c91ecfcd40/.github\n"
            "Berkeley DB 5.3.28: https://download.oracle.com/berkeley-db/db-5.3.28.tar.gz\n"
            "OpenSSL 3.5.9 (Linux/macOS): https://github.com/openssl/openssl/releases/tag/openssl-3.5.9\n"
            "OpenSSL 3.6.5 (Windows): https://github.com/openssl/openssl/releases/tag/openssl-3.6.5\n"
            "Windows dependency packaging: https://github.com/msys2/MINGW-packages\n"
            "GCC (Linux devtoolset-10): https://vault.centos.org/7.9.2009/sclo/Source/rh/\n"
            "Windows runtime: https://github.com/mingw-w64/mingw-w64/tree/e3d18511f\n"
            "zlib: https://github.com/madler/zlib\n"
            "See the build workflow log for the build commands and exact dependency package versions.\n",
            encoding="utf-8",
        )
        files = sorted(path for path in stage.rglob("*") if path.is_file())
        (stage / "SHA256SUMS.txt").write_text(
            "".join(f"{digest(path)}  {path.relative_to(stage).as_posix()}\n" for path in files),
            encoding="utf-8",
        )
        archive = dist / (name + extension)
        if extension == ".zip":
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
                for path in sorted(stage.rglob("*")):
                    if path.is_file():
                        output.write(path, path.relative_to(stage.parent).as_posix())
        else:
            with tarfile.open(archive, "w:gz") as output:
                output.add(stage, arcname=name)

        # Check the final archive contents, not only the staging directory.
        if extension == ".zip":
            with zipfile.ZipFile(archive) as packed:
                for path in files + [stage / "SHA256SUMS.txt"]:
                    assert hashlib.sha256(packed.read(path.relative_to(stage.parent).as_posix())).hexdigest() == digest(path)
        else:
            with tarfile.open(archive, "r:gz") as packed:
                for path in files + [stage / "SHA256SUMS.txt"]:
                    member = packed.getmember(path.relative_to(stage.parent).as_posix())
                    with packed.extractfile(member) as stream:
                        assert hashlib.file_digest(stream, "sha256").hexdigest() == digest(path)
                    if path == binary:
                        assert member.mode & 0o111
        (dist / (archive.name + ".sha256")).write_text(f"{digest(archive)}  {archive.name}\n", encoding="utf-8")
        print(f"Verified {archive.name}: {digest(archive)}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in CONFIG or not sys.argv[2].isdigit():
        sys.exit("Usage: package-node-release.py {linux|macos|windows} BUILD_RUN_ID")
    main(sys.argv[1], sys.argv[2])
