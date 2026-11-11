// node --experimental-strip-types packages/open-format/src/cli.ts validate <file>
// node --experimental-strip-types packages/open-format/src/cli.ts convert <plain.spindle> <out.spindle>
//
// Node's file system is reached through process.getBuiltinModule, so this file
// type-checks without Node's types and the package stays dependency-free.

import { FormatError } from './errors.ts';
import { plainToPackage, readAny } from './package.ts';

interface NodeFs {
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
}
interface NodeProcess {
  argv: string[];
  exitCode: number | undefined;
  getBuiltinModule(name: 'node:fs'): NodeFs;
}

const proc = (globalThis as unknown as { process: NodeProcess }).process;
const fs = proc.getBuiltinModule('node:fs');
const out = (line: string): void => console.log(line);

async function main(args: string[]): Promise<number> {
  const [command, input, output] = args;
  if (command === 'validate' && input && !output) {
    const read = await readAny(new Uint8Array(fs.readFileSync(input)));
    out(`OK ${read.kind}`);
    for (const w of read.warnings) out(`warning ${w.code}: ${w.message}`);
    return 0;
  }
  if (command === 'convert' && input && output) {
    const packed = await plainToPackage(new Uint8Array(fs.readFileSync(input)));
    fs.writeFileSync(output, packed);
    out(`OK wrote ${output} (${packed.length} bytes)`);
    return 0;
  }
  out('usage: cli.ts validate <file> | cli.ts convert <plain.spindle> <out.spindle>');
  return 2;
}

main(proc.argv.slice(2)).then(
  (code) => {
    proc.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof FormatError) {
      out(`${e.code}: ${e.message}`);
      proc.exitCode = 1;
    } else {
      out(`error: ${e instanceof Error ? e.message : String(e)}`);
      proc.exitCode = 3;
    }
  },
);
