import { createDbClient } from './drizzle-config.js';

/**
 * Database seed function.
 * Seeds demo org, users, and module data for local development.
 *
 * @param connectionString - App role connection string
 */
export async function seedDatabase(connectionString: string): Promise<void> {
  const db = createDbClient(connectionString);

  try {
    console.log('🌱 Seeding database...');

    // TODO: Implement seed logic in Phase 2
    // - Create demo organization
    // - Create admin user
    // - Create default roles and permissions
    // - Enable trial modules
    // - Insert sample data (currencies, etc.)

    console.log('✅ Database seeded successfully');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  }
}
