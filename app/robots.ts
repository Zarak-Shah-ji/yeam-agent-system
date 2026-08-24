import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // The app is entirely behind auth; /appeals is a link-shared review portal.
      disallow: '/',
    },
  }
}
