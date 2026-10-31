"""Copy static/ sources to Vercel's public/static/ CDN output.

Local Flask needs no build step. This copy preserves the same /static/... URLs
on Vercel. The generated public/ directory is ignored by Git; edit only static/.
"""

from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent


def prepare_static(destination: str | Path | None = None) -> Path:
    """
    Copy static sources into the CDN output directory for deployment.

    Args:
    - destination(str | Path | None): Optional output directory; defaults to public/static.

    Returns:
    - Path: The directory containing the copied static assets.
    """
    source = ROOT / "static"
    target = Path(destination) if destination is not None else ROOT / "public/static"
    shutil.copytree(source, target, dirs_exist_ok=True)
    return target


if __name__ == "__main__":
    print(f"Prepared static assets: {prepare_static()}")
