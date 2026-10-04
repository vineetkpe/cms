import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().default('Guides'),
    tags: z.array(z.string()).default([]),
    author: z.string().default('Editorial Team'),
    pubDate: z.coerce.date(),
    publishAt: z.coerce.date().optional(),
    updatedDate: z.coerce.date().optional(),
    featuredImage: z.string().optional(),
    featuredImageAlt: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    focusKeyword: z.string().optional(),
    canonical: z.string().optional(),
    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    ogImage: z.string().optional(),
    template: z.string().optional(),
    draft: z.boolean().default(false),
    noindex: z.boolean().default(false),
    nofollow: z.boolean().default(false),
    featured: z.boolean().default(false),
    hideAds: z.boolean().default(false),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([])
  })
});

export const collections = { posts };
