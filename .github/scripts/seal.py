"""Seal and unseal a folder of files, so a job that runs the kernel's code (and holds no key) can hand its results to
a job that holds the keys without the kernel's code being able to read or change them in between.

  seal.py keygen DIR            DIR/private.pem and DIR/public.pem (RSA 3072)
  seal.py seal SRC OUT PUB      tars SRC, encrypts it with fresh random keys (AES-256-CTR, HMAC-SHA256 over the
                                ciphertext) and wraps those keys to PUB (RSA-OAEP): OUT/data.enc and OUT/key.enc
  seal.py seal-tar TAR OUT PUB  the same for a tar file already made (tests)
  seal.py unseal IN OUT PRIV    unwraps with PRIV, checks the HMAC first, then extracts only plain files and folders
                                under OUT; anything else (absolute path, .., link, device) refuses the whole bundle
                                before anything is written

Only openssl (preinstalled on the runners) and the Python standard library are used. Prints nothing on success.
A job that holds the public key can seal anything; sealing keeps the contents private and untouched in transit, it does
not prove which job made them."""
import hmac
import io
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

MAX_BYTES = 2 * 1024 ** 3  # an unsealed bundle bigger than this is refused


def openssl(*args, data=None):
    out = subprocess.run(["openssl", *args], input=data, capture_output=True)
    if out.returncode != 0:
        sys.exit("openssl failed")
    return out.stdout


def mac(key, blob):
    return openssl("dgst", "-sha256", "-mac", "HMAC", "-macopt", "hexkey:" + key.hex(), "-binary", data=blob)


def keygen(d):
    os.makedirs(d, exist_ok=True)
    priv, pub = os.path.join(d, "private.pem"), os.path.join(d, "public.pem")
    openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", priv)
    os.chmod(priv, 0o600)
    with open(pub, "wb") as f:
        f.write(openssl("pkey", "-in", priv, "-pubout"))


def seal_tar_bytes(raw, out, pub):
    material = os.urandom(80)  # 32 cipher key, 16 iv, 32 mac key
    enc_key, iv, mac_key = material[:32], material[32:48], material[48:]
    blob = openssl("enc", "-aes-256-ctr", "-K", enc_key.hex(), "-iv", iv.hex(), data=raw)
    wrapped = openssl("pkeyutl", "-encrypt", "-pubin", "-inkey", pub, "-pkeyopt", "rsa_padding_mode:oaep",
                      "-pkeyopt", "rsa_oaep_md:sha256", data=material)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "data.enc"), "wb") as f:
        f.write(blob + mac(mac_key, blob))
    with open(os.path.join(out, "key.enc"), "wb") as f:
        f.write(wrapped)


def seal(src, out, pub):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for name in sorted(os.listdir(src)):
            t.add(os.path.join(src, name), arcname=name)
    seal_tar_bytes(buf.getvalue(), out, pub)


def unseal(src, out, priv):
    with open(os.path.join(src, "key.enc"), "rb") as f:
        wrapped = f.read()
    with open(os.path.join(src, "data.enc"), "rb") as f:
        both = f.read()
    material = openssl("pkeyutl", "-decrypt", "-inkey", priv, "-pkeyopt", "rsa_padding_mode:oaep",
                       "-pkeyopt", "rsa_oaep_md:sha256", data=wrapped)
    if len(material) != 80 or len(both) < 32:
        sys.exit("refused: not a sealed bundle")
    enc_key, iv, mac_key = material[:32], material[32:48], material[48:]
    blob, tag = both[:-32], both[-32:]
    if not hmac.compare_digest(mac(mac_key, blob), tag):
        sys.exit("refused: the bundle was changed")
    raw = openssl("enc", "-d", "-aes-256-ctr", "-K", enc_key.hex(), "-iv", iv.hex(), data=blob)
    extract(raw, out)


def extract(raw, out):
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r") as t:
        members = t.getmembers()
        total = 0
        for m in members:
            parts = m.name.split("/")
            if m.name.startswith("/") or ".." in parts or "\\" in m.name or "\0" in m.name:
                sys.exit("refused: unsafe path in the bundle")
            if not (m.isreg() or m.isdir()):
                sys.exit("refused: the bundle holds something other than files and folders")
            total += m.size
        if total > MAX_BYTES:
            sys.exit("refused: the bundle is too large")
        os.makedirs(out, exist_ok=True)
        root = os.path.realpath(out)
        for m in members:
            target = os.path.realpath(os.path.join(root, m.name))
            if target != root and not target.startswith(root + os.sep):
                sys.exit("refused: unsafe path in the bundle")
        for m in members:
            target = os.path.join(root, m.name)
            if m.isdir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with t.extractfile(m) as r, open(target, "wb") as w:
                shutil.copyfileobj(r, w)


def main(argv):
    cmd, args = (argv[1], argv[2:]) if len(argv) > 1 else ("", [])
    if cmd == "keygen" and len(args) == 1:
        keygen(*args)
    elif cmd == "seal" and len(args) == 3:
        seal(*args)
    elif cmd == "seal-tar" and len(args) == 3:
        with open(args[0], "rb") as f:
            seal_tar_bytes(f.read(), args[1], args[2])
    elif cmd == "unseal" and len(args) == 3:
        unseal(*args)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
