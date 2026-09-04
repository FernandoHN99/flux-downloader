export interface ManifestFile {
  placeholder: string;
  content: string;
}

export type HlsInputRewriter = (
  inputUrl: string,
  manifestIndex: number
) => Promise<ManifestFile | null>;

export interface PreparedHlsArguments {
  args: string[];
  manifestFiles: ManifestFile[];
}

const LOCAL_MANIFEST_INPUT_ARGS = [
  '-protocol_whitelist',
  'file,http,https,tcp,tls,crypto,data',
  '-extension_picky',
  '0'
];

/**
 * Visit every HTTP(S) FFmpeg input without mutating the array being scanned.
 * A rewritten input receives the local-manifest protocol options immediately
 * before its own `-i`.
 */
export async function prepareHlsInputArguments(
  args: string[],
  rewrite: HlsInputRewriter
): Promise<PreparedHlsArguments> {
  const prepared: string[] = [];
  const manifestFiles: ManifestFile[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inputUrl = args[index + 1];
    if (argument !== '-i' || !/^https?:\/\//i.test(inputUrl || '')) {
      prepared.push(argument);
      continue;
    }

    const manifest = await rewrite(inputUrl, manifestFiles.length);
    if (manifest) {
      prepared.push(...LOCAL_MANIFEST_INPUT_ARGS, '-i', manifest.placeholder);
      manifestFiles.push(manifest);
    } else {
      prepared.push('-i', inputUrl);
    }
    index += 1;
  }

  return { args: prepared, manifestFiles };
}
