-- Version 2: business columns are authoritative; shape/extra preserve legacy optional fields.
CREATE TABLE app_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, state_keys TEXT NOT NULL, schema_version INTEGER NOT NULL CHECK(schema_version=2));
CREATE TABLE state_extensions(key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE users(id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
CREATE TABLE recipes(id TEXT PRIMARY KEY);
CREATE TABLE kitchens(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, subtitle TEXT NOT NULL,
  chef_id TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  owner_id TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  chef_label TEXT NOT NULL, diner_label TEXT NOT NULL, sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL
);
CREATE TABLE memberships(
  row_key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kitchen_id TEXT NOT NULL REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED,
  role TEXT NOT NULL CHECK(role IN ('chef','diner')), sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL,
  UNIQUE(kitchen_id,user_id)
);
CREATE UNIQUE INDEX one_chef_per_kitchen ON memberships(kitchen_id) WHERE role='chef';
CREATE INDEX memberships_user ON memberships(user_id,kitchen_id);
CREATE TABLE recipe_versions(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, review_key TEXT REFERENCES recipes(id) DEFERRABLE INITIALLY DEFERRED,
  name TEXT NOT NULL, category TEXT NOT NULL, minutes INTEGER, servings INTEGER, note TEXT NOT NULL, art TEXT NOT NULL,
  source TEXT, source_text TEXT, archived INTEGER CHECK(archived IN (0,1)),
  sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL
);
CREATE INDEX recipes_category ON recipe_versions(category,archived,id);
CREATE INDEX recipes_history ON recipe_versions(review_key,id);
CREATE TABLE recipe_ingredients(
  recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  position INTEGER NOT NULL, name TEXT NOT NULL, amount REAL, unit TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('food','seasoning')),
  shape TEXT NOT NULL, extra TEXT NOT NULL, PRIMARY KEY(recipe_id,position)
);
CREATE INDEX ingredients_name ON recipe_ingredients(name,recipe_id);
CREATE TABLE recipe_steps(recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, position INTEGER NOT NULL, instruction TEXT NOT NULL, PRIMARY KEY(recipe_id,position));
CREATE TABLE kitchen_menu(kitchen_id TEXT NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, position INTEGER NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(kitchen_id,position), UNIQUE(kitchen_id,recipe_id));
CREATE INDEX menu_recipe ON kitchen_menu(recipe_id,kitchen_id);
CREATE TABLE meals(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kitchen_id TEXT NOT NULL REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED,
  date TEXT NOT NULL, name TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','prep','cooking','done','cancelled')), sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL,
  UNIQUE(id,kitchen_id), UNIQUE(kitchen_id,date,name)
);
CREATE INDEX meals_calendar ON meals(kitchen_id,date,starts_at);
CREATE INDEX meals_open ON meals(kitchen_id,status,deadline);
CREATE TABLE meal_portions(meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) DEFERRABLE INITIALLY DEFERRED, quantity REAL NOT NULL CHECK(quantity>=0), position INTEGER NOT NULL, PRIMARY KEY(meal_id,recipe_id));
CREATE INDEX portions_recipe ON meal_portions(recipe_id);
CREATE TABLE meal_grants(
  row_key TEXT PRIMARY KEY, meal_id TEXT NOT NULL REFERENCES meals(id) DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES users(id), revoked INTEGER CHECK(revoked IN (0,1)), sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL
);
CREATE INDEX grants_user_meal ON meal_grants(user_id,meal_id,revoked);
CREATE INDEX grants_meal ON meal_grants(meal_id);
CREATE TABLE orders(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
  meal_id TEXT NOT NULL REFERENCES meals(id) DEFERRABLE INITIALLY DEFERRED, note TEXT NOT NULL, created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL, UNIQUE(meal_id,user_id)
);
CREATE INDEX orders_user_history ON orders(user_id,created_at DESC);
CREATE TABLE order_items(order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, position INTEGER NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(order_id,position), UNIQUE(order_id,recipe_id));
CREATE INDEX order_items_recipe ON order_items(recipe_id,order_id);
CREATE TABLE inventory(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kitchen_id TEXT NOT NULL REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED,
  name TEXT NOT NULL, amount REAL CHECK(amount IS NULL OR amount>=0), unit TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('food','seasoning')),
  sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL, UNIQUE(kitchen_id,name,unit)
);
CREATE INDEX inventory_type ON inventory(kitchen_id,type,name);
CREATE TABLE invitations(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kitchen_id TEXT NOT NULL REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED,
  type TEXT NOT NULL CHECK(type IN ('long','temporary')), meal_id TEXT REFERENCES meals(id) DEFERRABLE INITIALLY DEFERRED,
  expires_at TEXT NOT NULL, sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL
);
CREATE INDEX invitations_kitchen_expiry ON invitations(kitchen_id,expires_at);
CREATE INDEX invitations_meal ON invitations(meal_id);
CREATE TABLE reviews(
  row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, kitchen_id TEXT NOT NULL REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED,
  meal_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  recipe_id TEXT REFERENCES recipe_versions(id) DEFERRABLE INITIALLY DEFERRED,
  recipe_key TEXT REFERENCES recipes(id) DEFERRABLE INITIALLY DEFERRED,
  text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL,
  FOREIGN KEY(meal_id,kitchen_id) REFERENCES meals(id,kitchen_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX review_once_dish ON reviews(meal_id,user_id,recipe_id) WHERE recipe_id IS NOT NULL;
CREATE UNIQUE INDEX review_once_meal ON reviews(meal_id,user_id) WHERE recipe_id IS NULL;
CREATE INDEX reviews_kitchen_time ON reviews(kitchen_id,updated_at DESC,id);
CREATE INDEX reviews_recipe_history ON reviews(kitchen_id,recipe_key,updated_at DESC,id);
CREATE INDEX reviews_user ON reviews(user_id,updated_at DESC);
CREATE INDEX reviews_recipe_version ON reviews(recipe_id);
CREATE INDEX reviews_recipe_key ON reviews(recipe_key);
CREATE TABLE feedback(row_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, sort_order INTEGER NOT NULL, shape TEXT NOT NULL, extra TEXT NOT NULL);
CREATE TABLE shopping_checks(key TEXT PRIMARY KEY, meal_id TEXT REFERENCES meals(id) DEFERRABLE INITIALLY DEFERRED, signature TEXT NOT NULL, position INTEGER NOT NULL);
CREATE INDEX checks_meal ON shopping_checks(meal_id);
CREATE TABLE mark_groups(kind TEXT NOT NULL CHECK(kind IN ('signatures','favorites')), key TEXT NOT NULL, kitchen_id TEXT REFERENCES kitchens(id) DEFERRABLE INITIALLY DEFERRED, user_id TEXT REFERENCES users(id), position INTEGER NOT NULL, PRIMARY KEY(kind,key));
CREATE TABLE recipe_marks(kind TEXT NOT NULL, key TEXT NOT NULL, position INTEGER NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipe_versions(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(kind,key,position), FOREIGN KEY(kind,key) REFERENCES mark_groups(kind,key) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX marks_recipe ON recipe_marks(recipe_id);
CREATE INDEX marks_member ON mark_groups(kitchen_id,user_id,kind);
CREATE TABLE sync_changes(revision INTEGER PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, body TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE migration_audit(version INTEGER PRIMARY KEY, migrated_at TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, record_counts TEXT NOT NULL);
PRAGMA user_version=2;
