import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
mkdirSync(distDir, { recursive: true });

// Copy static files to dist
const staticFiles = [
    'manifest.json',
    'popup.html',
    'popup.css',
    'options.html',
    'options.css',
];

for (const file of staticFiles) {
    const src = resolve(srcDir, file);
    if (existsSync(src)) {
        cpSync(src, resolve(distDir, file));
    }
}

// Copy icons directory
const iconsDir = resolve(srcDir, 'icons');
if (existsSync(iconsDir)) {
    cpSync(iconsDir, resolve(distDir, 'icons'), { recursive: true });
}

// Bundle TypeScript entry points
const entryPoints = [
    resolve(srcDir, 'popup.ts'),
    resolve(srcDir, 'options.ts'),
    resolve(srcDir, 'background.ts'),
];

const buildOptions = {
    entryPoints,
    bundle: true,
    outdir: distDir,
    format: 'iife',
    target: 'es2020',
    minify: !isWatch,
    sourcemap: false,
    define: {
        'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    },
};

if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('👀 Watching for changes...');
} else {
    await esbuild.build(buildOptions);
    console.log('✅ Build complete → dist/');
}
