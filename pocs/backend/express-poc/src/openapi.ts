const route = (tag: string, secured = false) => ({
  tags: [tag],
  ...(secured && { security: [{ bearer: [] }] }),
  responses: { default: { description: '' } },
});

export const openapiDocument = {
  openapi: '3.0.0',
  info: { title: 'AREA Express POC', version: '0.0.1' },
  paths: {
    '/auth/register': { post: route('auth') },
    '/auth/login': { post: route('auth') },
    '/auth/me': { get: route('auth', true) },
    '/hooks/webhook': { post: route('hooks') },
    '/hooks/events': { get: route('hooks', true) },
  },
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
};
