import {
    copyFile,
    mkdir,
    rm,
    stat
} from "node:fs/promises";

import {
    dirname,
    resolve
} from "node:path";

const projectRoot = process.cwd();
const outputDirectory = resolve(projectRoot, "dist");

const filesToPublish = [
    "index.html",
    "style.css",
    "app.js",
    "auth.js",
    "supabase-client.js",
    "supabase-data.js",
    "assets/gtasa-map-shadows.jpg"
];

console.log("SA Event Maps - przygotowanie publikacji");

for (const relativePath of filesToPublish) {
    const sourcePath = resolve(projectRoot, relativePath);

    try {
        const fileInfo = await stat(sourcePath);

        if (!fileInfo.isFile()) {
            throw new Error("To nie jest zwykly plik.");
        }
    } catch {
        throw new Error(
            `Brakuje wymaganego pliku: ${relativePath}`
        );
    }
}

await rm(outputDirectory, {
    recursive: true,
    force: true
});

await mkdir(outputDirectory, {
    recursive: true
});

for (const relativePath of filesToPublish) {
    const sourcePath = resolve(projectRoot, relativePath);
    const destinationPath = resolve(
        outputDirectory,
        relativePath
    );

    await mkdir(dirname(destinationPath), {
        recursive: true
    });

    await copyFile(sourcePath, destinationPath);

    console.log(`OK: ${relativePath}`);
}

console.log("");
console.log("Publikacja przygotowana pomyslnie.");
console.log("Katalog wynikowy: dist/");