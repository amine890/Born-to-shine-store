-- =====================================================
-- Born To Shine - Schéma de base de données Supabase
-- =====================================================

-- Extension pour UUID
create extension if not exists "uuid-ossp";

-- ========== CATEGORIES ==========
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique,
  created_at timestamptz default now()
);

-- ========== PRODUCTS ==========
create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  category text,
  base_price numeric(10,2) not null default 0,
  discount numeric(5,2) default 0,
  is_featured boolean default false,
  sizes text[] default '{}',
  colors jsonb default '[]',
  seo_title text,
  seo_description text,
  promotion_start timestamptz,
  promotion_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index pour accélérer les filtres
create index idx_products_category on products(category);
create index idx_products_featured on products(is_featured);
create index idx_products_created on products(created_at desc);

-- ========== ORDERS ==========
create table orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text unique not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address text,
  city text,
  postal_code text,
  notes text,
  items jsonb default '[]',
  subtotal numeric(10,2) default 0,
  delivery_fee numeric(10,2) default 0,
  coupon_code text,
  coupon_discount numeric(10,2) default 0,
  total numeric(10,2) default 0,
  status text default 'Nouveau',
  created_at timestamptz default now()
);

create index idx_orders_status on orders(status);
create index idx_orders_created on orders(created_at desc);
create index idx_orders_number on orders(order_number);

-- ========== COUPONS ==========
create table coupons (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  discount numeric(10,2) not null,
  discount_type text default 'percentage' check (discount_type in ('percentage', 'fixed')),
  min_order numeric(10,2) default 0,
  expiration_date timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ========== REVIEWS ==========
create table reviews (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade,
  customer_name text not null,
  rating int check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz default now()
);

create index idx_reviews_product on reviews(product_id);

-- ========== BANNERS ==========
create table banners (
  id uuid primary key default uuid_generate_v4(),
  title text,
  subtitle text,
  image_url text,
  link_url text,
  is_active boolean default true,
  order_num int default 0,
  created_at timestamptz default now()
);

-- ========== SETTINGS (singleton) ==========
create table settings (
  id int primary key default 1 check (id = 1),
  delivery_fee numeric(10,2) default 15,
  low_stock_threshold int default 5,
  whatsapp text,
  email text,
  instagram text,
  facebook text,
  company_address text,
  admin_password_hash text default '$2b$10$defaulthashedpasswordforadmin123',
  updated_at timestamptz default now()
);

-- Insérer la ligne singleton par défaut
insert into settings (id) values (1) on conflict do nothing;

-- ========== WISHLIST (par session) ==========
create table wishlist (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null,
  product_ids uuid[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(session_id)
);

-- ========== SEQUENCE pour numéro de commande ==========
create sequence order_number_seq start 1;

-- Fonction pour générer le prochain numéro de commande
create or replace function generate_order_number()
returns text as $$
declare
  next_val int;
  year text;
begin
  select nextval('order_number_seq') into next_val;
  year := extract(year from now())::text;
  return 'CH-' || year || '-' || lpad(next_val::text, 6, '0');
end;
$$ language plpgsql;

-- ========== ROW LEVEL SECURITY (RLS) ==========
-- Activer RLS sur toutes les tables
alter table categories enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table coupons enable row level security;
alter table reviews enable row level security;
alter table banners enable row level security;
alter table settings enable row level security;
alter table wishlist enable row level security;

-- Lectures publiques (pour le frontend storefront)
create policy "Public read categories" on categories for select using (true);
create policy "Public read products" on products for select using (true);
create policy "Public read banners" on banners for select using (is_active = true);
create policy "Public read reviews" on reviews for select using (true);
create policy "Public read coupons" on coupons for select using (is_active = true);
create policy "Public read settings" on settings for select using (true);

-- Écritures publiques (commandes et avis clients)
create policy "Public create orders" on orders for insert with check (true);
create policy "Public create reviews" on reviews for insert with check (true);

-- Wishlist par session
create policy "Public wishlist all" on wishlist for all using (true) with check (true);

-- Note : Les routes admin utiliseront la clé service_role qui bypass RLS
-- Pas besoin de policy admin séparée