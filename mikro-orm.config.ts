import { defineConfig } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

export default defineConfig({
  entities: ['./dist/**/*.entity.js'],
  entitiesTs: ['./src/**/*.entity.ts'],
  dbName: process.env.DB_NAME || 'jungle_wagering',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  metadataProvider: TsMorphMetadataProvider,
  migrations: {
    path: './dist/infrastructure/persistence/migrations',
    pathTs: './src/infrastructure/persistence/migrations',
  },
});
