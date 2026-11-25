import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages the deploy workflow sets SITE_URL to the public base URL
// (e.g. https://user.github.io/repo/) so Open Graph image URLs are absolute.
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';

/** Rewrites root-relative social image URLs to absolute ones when SITE_URL is set. */
function absoluteSocialUrls() {
    return {
        name: 'absolute-social-urls',
        transformIndexHtml(html) {
            return html.replace(
                /(<meta (?:property="og:image"|name="twitter:image") content=")(?:\.\/|\/)?([^"]+)"/g,
                (_, pre, path) => (siteUrl ? `${pre}${siteUrl}${path}"` : `${pre}${path}"`)
            );
        }
    };
}

export default defineConfig({
    // Relative base: works on user.github.io/<repo>/ and on custom domains.
    base: './',
    build: { target: 'es2020' },
    plugins: [
        absoluteSocialUrls(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
            manifest: {
                name: "Grand Larceny '97",
                short_name: "Larceny '97",
                description: "Steal cars. Cause havoc. Blame the '90s.",
                theme_color: '#0d0d0c',
                background_color: '#0d0d0c',
                display: 'fullscreen',
                display_override: ['fullscreen', 'standalone'],
                orientation: 'any',
                start_url: './',
                scope: './',
                icons: [
                    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'] }
        })
    ]
});
