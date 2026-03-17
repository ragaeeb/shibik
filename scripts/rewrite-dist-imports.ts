export const rewriteImports = (source: string) => {
    return source
        .replace(/from\s+(["'])@\//g, 'from $1./')
        .replace(/import\s+(["'])@\//g, 'import $1./')
        .replace(/\bimport\s*\(\s*(["'])@\//g, 'import($1./');
};

if (import.meta.main) {
  const glob = new Bun.Glob("dist/**/*.js");
  let updated = 0;

  for await (const filePath of glob.scan(".")) {
    const file = Bun.file(filePath);
    const contents = await file.text();
    const next = rewriteImports(contents);

    if (next !== contents) {
      await Bun.write(filePath, next);
      updated += 1;
    }
  }

  if (updated > 0) {
    console.log(`Rewrote ${updated} dist import paths.`);
  }
}
