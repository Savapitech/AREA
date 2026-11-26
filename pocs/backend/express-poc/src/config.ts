function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  db: {
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    username: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },
  jwtSecret: required('JWT_SECRET'),
  hookSecret: required('HOOK_SECRET'),
};
