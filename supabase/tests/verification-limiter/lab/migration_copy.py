"""Offline Git export/copy utility; never executes SQL or database tools."""
import argparse
import os
import secrets
import stat
from pathlib import Path
import subprocess
from common import COMMIT, GATE, MIGRATION, REVIEWED, REPOSITORY, SOURCE_HASH, digest, require, validate_copy, workspace_path


def executable_copy(blocked):
    require(blocked.count(GATE) == 1 and blocked.count(b'DO $external_review_gate$') == 1,
            'Missing/duplicated exact gate')
    require(digest(blocked) == SOURCE_HASH, 'Committed source hash mismatch')
    executable = blocked.replace(GATE, b'', 1)
    validate_copy(blocked, executable)
    return executable


def _private_directory(fd):
    info = os.fstat(fd)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'Destination directory must be owned/private 0700')


def write_new(path, data):
    """POSIX same-directory hard-link publication: atomic visibility + no clobber.
    Every directory is reached via O_NOFOLLOW/dir_fd, not a checked path reopened.
    Ordinary failures remove temporary names; published names always contain verified
    complete bytes. Power loss/directory-fsync failure may leave a COMPLETE final file.
    """
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Absolute non-traversing path required')
    roots = [p for p in path.parents if p.parent == Path('/private/tmp')]
    require(len(roots) == 1, 'Destination outside disposable workspace')
    root = workspace_path(roots[0])
    parts = path.relative_to(root).parts
    require(parts and all(p not in ('', '.', '..') for p in parts), 'Invalid destination components')
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = None
    fd = None
    try:
        _private_directory(directory)
        for part in parts[:-1]:
            try:
                os.mkdir(part, 0o700, dir_fd=directory)
                os.fsync(directory)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            try:
                _private_directory(child)
            except BaseException:
                os.close(child)
                raise
            os.close(directory)
            directory = child
        name = '.limiter-publish-' + secrets.token_hex(16)
        fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        temporary = name
        require(stat.S_IMODE(os.fstat(fd).st_mode) == 0o600, 'Temporary mode must be 0600')
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            require(written > 0, 'Zero-length write')
            view = view[written:]
        os.fsync(fd)  # Unbuffered os.write needs no additional Python buffer flush.
        os.lseek(fd, 0, os.SEEK_SET)
        chunks = []
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            chunks.append(chunk)
        require(b''.join(chunks) == data, 'Publication byte verification failed')
        os.close(fd)
        fd = None
        # link() atomically creates a NEW directory entry or fails EEXIST; it cannot
        # replace even a symlink destination. Both names live on the same filesystem.
        os.link(temporary, parts[-1], src_dir_fd=directory, dst_dir_fd=directory,
                follow_symlinks=False)
        os.fsync(directory)
    finally:
        try:
            if fd is not None:
                os.close(fd)
        finally:
            try:
                if temporary is not None:
                    os.unlink(temporary, dir_fd=directory)
                    os.fsync(directory)
            finally:
                os.close(directory)


def export(workspace, repository=REPOSITORY):
    w = workspace_path(workspace, repository)
    require(not (w / 'reviewed').exists() and not (w / 'copies').exists(), 'Refusing overwrite')
    blobs = {}
    for name in REVIEWED:
        blobs[name] = subprocess.check_output(['git', '-C', str(repository), 'show', COMMIT + ':' + name], timeout=10)
    blocked = blobs[MIGRATION]
    executable = executable_copy(blocked)
    for name, data in blobs.items():
        write_new(w / 'reviewed' / name, data)
    write_new(w / 'copies/limiter.blocked.sql', blocked)
    write_new(w / 'copies/limiter.executable.sql', executable)
    return {str(p.relative_to(w)): digest(p.read_bytes()) for p in w.rglob('*') if p.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    args = parser.parse_args()
    export(args.workspace)
    print('Offline copies exported; exact byte-level gate removal verified. No SQL executed.')


if __name__ == '__main__':
    main()
