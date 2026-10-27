import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where finished clips go. Swap in object storage by implementing this. */
export interface Storage {
  /** Save bytes under `name`. Returns a locator (a path, a URL) for the saved object. */
  save(name: string, data: Buffer, mimeType: string): Promise<string>;
}

/** Writes into a directory on the local disk. */
export class LocalStorage implements Storage {
  constructor(private readonly directory: string) {}

  async save(name: string, data: Buffer): Promise<string> {
    const safe = path.basename(name);
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, safe);
    await writeFile(target, data);
    return target;
  }
}
