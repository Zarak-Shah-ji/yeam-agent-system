export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'yeam-theme'

export const THEME_CLASS = 'dark'

/**
 * Runs before first paint, so nobody sees a white flash before the app settles.
 *
 * Dark is the product's default: only an explicit stored 'light' turns it off.
 * The OS preference is deliberately not consulted — a billing team on a
 * light-defaulted laptop would otherwise never see the theme the app is
 * designed in, and the sidebar toggle is the one that should decide this.
 *
 * The class is added outside the try, so a browser that refuses localStorage
 * (private mode, storage disabled) still lands on the default rather than
 * falling through to light.
 *
 * This lives in a plain module rather than in theme-context.tsx: values
 * exported from a `'use client'` file arrive at a server component as client
 * references, and the key would inline as `undefined`.
 */
export const themeBootstrapScript = `
(function(){var s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}
if(s!=='light')document.documentElement.classList.add(${JSON.stringify(THEME_CLASS)})})()
`
