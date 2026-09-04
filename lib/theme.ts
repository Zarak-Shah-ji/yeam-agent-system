export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'yeam-theme'

export const THEME_CLASS = 'dark'

/**
 * Runs before first paint, so a dark-mode user never sees a white flash.
 * A stored choice wins; with nothing stored we follow the OS.
 *
 * This lives in a plain module rather than in theme-context.tsx: values
 * exported from a `'use client'` file arrive at a server component as client
 * references, and the key would inline as `undefined`.
 */
export const themeBootstrapScript = `
(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
if(d)document.documentElement.classList.add(${JSON.stringify(THEME_CLASS)})}catch(e){}})()
`
