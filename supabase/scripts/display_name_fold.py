"""Generates the look-alike fold in supabase/migrations/20261113210000_display_names_fold.sql (display_name_key).

Input: Unicode's confusables data as JSON, as bundled by the MIT package confusable_homoglyphs 3.3.1
(confusable_homoglyphs/confusables.json; `pip download --no-deps confusable-homoglyphs`, then unzip). Only its data
file is read. Prints the SQL expression over `s` that the migration wraps.
Run: python3 -I supabase/scripts/display_name_fold.py <confusables.json>
"""
import json, sys, unicodedata as u
d = json.load(open(sys.argv[1]))
clean = lambda s: s.replace("‎", "").replace("‏", "")
MARKS = [(0x300, 0x36f), (0x1ab0, 0x1aff), (0x1dc0, 0x1dff), (0x20d0, 0x20ff), (0xfe20, 0xfe2f)]
def strip(s):
    s = u.normalize("NFKD", s)
    return "".join(c for c in s if not any(a <= ord(c) <= b for a, b in MARKS))
def ascii_alnum(s): return s != "" and all(c.isascii() and c.isalnum() for c in s)
def accepted(c):  # could appear in a name: the script ranges display_name_script_ok knows, NFKC-stable, a letter
    o = ord(c)
    ranges = [(192, 591), (7680, 7935), (880, 1023), (1024, 1327), (1328, 1423), (1424, 1535), (1536, 1791), (2304, 2431), (3584, 3711), (4352, 4607), (44032, 55215), (12352, 12543), (19968, 40959)]
    return (c.isascii() and c.isalnum()) or (any(a <= o <= b for a, b in ranges) and u.normalize("NFKC", c) == c and c.isalpha())
fold = {}
for x, es in d.items():
    x = clean(x)
    if len(x) != 1 or not accepted(x) or (x.isascii()):
        continue
    if len(es) == 1:
        t = strip(clean(es[0]["c"]))
        if ascii_alnum(t):
            fold[x] = t
for a in [chr(c) for c in range(48, 123) if chr(c).isalnum()]:
    for e in d.get(a, []):
        s = clean(e["c"])
        if len(s) == 1 and accepted(s) and not s.isascii():
            if s in fold and fold[s] != a:
                print("conflict", repr(s), fold[s], a, file=sys.stderr)
            fold.setdefault(s, a)

# By hand: letters of real names that look like no single plain letter in the data, written as people write them
# without the letter (and wynn, which the hunt showed passing as p).
HAND = {"ß": "ss", "ẞ": "SS", "þ": "th", "Þ": "TH", "ð": "d", "ŋ": "n", "Ŋ": "N", "ĸ": "k", "ƿ": "p", "Ƿ": "P"}
m = {}
for src, dst in list(fold.items()) + list(HAND.items()):
    k = strip(src)
    if len(k) != 1 or k.isascii():
        continue
    m[k] = dst
single = sorted((k, v) for k, v in m.items() if len(v) == 1)
multi = sorted((k, v) for k, v in m.items() if len(v) > 1)
frm = "".join(k for k, _ in single); to = "".join(v for _, v in single)
esc = lambda s: s.replace("'", "''")
expr = f"translate(s, '{esc(frm)}', '{esc(to)}')"
for k, v in multi:
    expr = f"replace({expr}, '{k}', '{v}')"
print(len(single), len(multi), file=sys.stderr)
print(expr)
