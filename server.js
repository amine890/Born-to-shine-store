/**
 * Born To Shine - Luxury Fashion E-commerce Platform
 * Backend API — Supabase Edition
 * Port: 3050
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3050;
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Créer le dossier uploads s'il n'existe pas (fallback local si Supabase Storage échoue)
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ==================== SUPABASE CLIENT ====================
// On utilise service_role pour toutes les opérations serveur (bypass RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

// ==================== EXPRESS SETUP ====================
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir les uploads locaux en fallback
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer configuration (stockage mémoire pour upload vers Supabase)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers images sont autorisés'));
    }
  }
});

// ==================== HELPERS ====================

/**
 * Upload une image vers Supabase Storage
 * Retourne l'URL publique ou null en cas d'erreur
 */
async function uploadImageToStorage(file) {
  if (!file) return null;
  try {
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '31536000',
        upsert: false
      });

    if (error) {
      console.error('Supabase upload error:', error);
      // Fallback : sauvegarde locale
      return saveImageLocally(file);
    }

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (err) {
    console.error('Upload error:', err);
    return saveImageLocally(file);
  }
}

/** Fallback local si Supabase Storage échoue */
function saveImageLocally(file) {
  const fileExt = file.originalname.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return `/uploads/${fileName}`;
}

/**
 * Middleware d'authentification admin
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/**
 * Helper pour obtenir les settings (singleton)
 */
async function getSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();
  
  if (error) {
    console.error('getSettings error:', error);
    return {
      delivery_fee: 15,
      low_stock_threshold: 5,
      whatsapp: null,
      email: null,
      instagram: null,
      facebook: null,
      company_address: null
    };
  }
  return data;
}

/**
 * Formate un produit pour le frontend (compatibilité)
 */
function formatProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    basePrice: parseFloat(row.base_price) || 0,
    discount: parseFloat(row.discount) || 0,
    isFeatured: row.is_featured || false,
    sizes: row.sizes || [],
    colors: row.colors || [],
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    promotion: (row.promotion_start || row.promotion_end) ? {
      startDate: row.promotion_start,
      endDate: row.promotion_end
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Formate une commande pour le frontend
 */
function formatOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    address: row.address,
    city: row.city,
    postalCode: row.postal_code,
    notes: row.notes,
    items: row.items || [],
    subtotal: parseFloat(row.subtotal) || 0,
    deliveryFee: parseFloat(row.delivery_fee) || 0,
    couponCode: row.coupon_code,
    couponDiscount: parseFloat(row.coupon_discount) || 0,
    total: parseFloat(row.total) || 0,
    status: row.status,
    createdAt: row.created_at
  };
}

/**
 * Formate un coupon pour le frontend
 */
function formatCoupon(row) {
  return {
    id: row.id,
    code: row.code,
    discount: parseFloat(row.discount) || 0,
    discountType: row.discount_type,
    minOrder: parseFloat(row.min_order) || 0,
    expirationDate: row.expiration_date,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}

// =====================================================
// ==================== ROUTES PUBLIQUES ==============
// =====================================================

// ---------- SETTINGS ----------
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      deliveryFee: parseFloat(settings.delivery_fee) || 15,
      lowStockThreshold: settings.low_stock_threshold || 5,
      whatsapp: settings.whatsapp,
      email: settings.email,
      instagram: settings.instagram,
      facebook: settings.facebook,
      companyAddress: settings.company_address
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CATEGORIES ----------
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- PRODUCTS ----------
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(formatProduct));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(formatProduct(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ORDERS (public create + track) ----------
app.post('/api/orders', async (req, res) => {
  try {
    const {
      customerName, customerPhone, customerEmail,
      address, city, postalCode, notes,
      items, couponCode, couponDiscount
    } = req.body;

    if (!customerName || !customerPhone || !items || items.length === 0) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Générer le numéro de commande
    const { data: numData, error: numError } = await supabase.rpc('generate_order_number');
    if (numError) throw numError;
    const orderNumber = numData;

    const settings = await getSettings();
    const deliveryFee = parseFloat(settings.delivery_fee) || 15;

    const subtotal = items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
    const discount = parseFloat(couponDiscount) || 0;
    const total = Math.max(0, subtotal + deliveryFee - discount);

    // Vérifier stock et décrémenter
    for (const item of items) {
      const { data: product, error: pErr } = await supabase
        .from('products')
        .select('id, colors')
        .eq('id', item.productId)
        .single();
      
      if (pErr || !product) {
        return res.status(400).json({ error: `Produit non trouvé: ${item.productId}` });
      }

      const colors = product.colors || [];
      const colorIdx = colors.findIndex(c => c.name === item.color);
      if (colorIdx === -1) {
        return res.status(400).json({ error: `Couleur non trouvée: ${item.color}` });
      }

      const currentStock = colors[colorIdx].stock || 0;
      if (currentStock < item.quantity) {
        return res.status(400).json({ 
          error: `Stock insuffisant pour ${item.productName} (${item.color}). Disponible: ${currentStock}`
        });
      }

      colors[colorIdx].stock = currentStock - item.quantity;

      const { error: uErr } = await supabase
        .from('products')
        .update({ colors, updated_at: new Date().toISOString() })
        .eq('id', item.productId);
      
      if (uErr) throw uErr;
    }

    // Créer la commande
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        address, city, postal_code: postalCode, notes,
        items,
        subtotal,
        delivery_fee: deliveryFee,
        coupon_code: couponCode,
        coupon_discount: discount,
        total,
        status: 'Nouveau'
      })
      .select()
      .single();
    
    if (oErr) throw oErr;

    res.json({ success: true, orderNumber, order: formatOrder(order) });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', req.params.orderNumber)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }
    res.json(formatOrder(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- COUPONS (public validate) ----------
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code, orderTotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });

    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();
    
    if (error || !data) {
      return res.json({ valid: false, error: 'Coupon invalide ou expiré' });
    }

    // Vérifier expiration
    if (data.expiration_date) {
      const expDate = new Date(data.expiration_date);
      expDate.setHours(23, 59, 59, 999);
      if (new Date() > expDate) {
        return res.json({ valid: false, error: 'Coupon expiré' });
      }
    }

    // Vérifier commande minimum
    if (data.min_order && orderTotal < parseFloat(data.min_order)) {
      return res.json({ 
        valid: false, 
        error: `Commande minimum requise: ${data.min_order} DT` 
      });
    }

    // Calculer remise
    let discount = 0;
    if (data.discount_type === 'percentage') {
      discount = orderTotal * (parseFloat(data.discount) / 100);
    } else {
      discount = parseFloat(data.discount);
    }

    res.json({ valid: true, discount: Math.min(discount, orderTotal), coupon: formatCoupon(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- REVIEWS ----------
app.get('/api/reviews', async (req, res) => {
  try {
    let query = supabase.from('reviews').select('*');
    if (req.query.productId) {
      query = query.eq('product_id', req.query.productId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { productId, customerName, rating, comment } = req.body;
    if (!productId || !customerName || !rating) {
      return res.status(400).json({ error: 'Données manquantes' });
    }
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        product_id: productId,
        customer_name: customerName,
        rating: parseInt(rating),
        comment: comment || null
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- BANNERS ----------
app.get('/api/banners', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .eq('is_active', true)
      .order('order_num', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- WISHLIST (par session) ----------
app.get('/api/wishlist/:sessionId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('wishlist')
      .select('*')
      .eq('session_id', req.params.sessionId)
      .single();
    
    if (error || !data) {
      return res.json({ session_id: req.params.sessionId, product_ids: [] });
    }
    res.json({ session_id: data.session_id, product_ids: data.product_ids || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wishlist/:sessionId', async (req, res) => {
  try {
    const { productIds } = req.body;
    const { error } = await supabase
      .from('wishlist')
      .upsert({
        session_id: req.params.sessionId,
        product_ids: productIds || [],
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id' });
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ==================== ADMIN AUTH ====================
// =====================================================

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Mot de passe requis' });
    }

    const settings = await getSettings();
    const storedHash = settings.admin_password_hash;

    let valid = false;

    // Premier login : le hash par défaut est en clair, on le hash
    if (storedHash && !storedHash.startsWith('$2')) {
      if (password === storedHash) {
        const newHash = await bcrypt.hash(password, 10);
        await supabase
          .from('settings')
          .update({ admin_password_hash: newHash })
          .eq('id', 1);
        valid = true;
      }
    } else if (storedHash) {
      valid = await bcrypt.compare(password, storedHash);
    }

    // Fallback : mot de passe par défaut depuis .env
    if (!valid && password === (process.env.ADMIN_DEFAULT_PASSWORD || 'admin123')) {
      const newHash = await bcrypt.hash(password, 10);
      await supabase
        .from('settings')
        .update({ admin_password_hash: newHash })
        .eq('id', 1);
      valid = true;
    }

    if (!valid) {
      return res.status(401).json({ success: false, error: 'Mot de passe incorrect' });
    }

    const token = jwt.sign({ role: 'admin', iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ==================== ADMIN ROUTES ==================
// =====================================================

// Helper pour protéger les routes admin
const admin = authMiddleware;

// ---------- ANALYTICS ----------
app.get('/api/analytics', admin, async (req, res) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*');
    const { data: products } = await supabase.from('products').select('*');
    const settings = await getSettings();
    const lowStockThreshold = settings.low_stock_threshold || 5;

    const allOrders = orders || [];
    const totalRevenue = allOrders
      .filter(o => o.status !== 'Annulé')
      .reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    
    const pendingOrders = allOrders.filter(o => ['Nouveau', 'Confirmé', 'En préparation'].includes(o.status)).length;
    const completedOrders = allOrders.filter(o => o.status === 'Livré').length;
    const cancelledOrders = allOrders.filter(o => o.status === 'Annulé').length;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayRevenue = allOrders
      .filter(o => o.status !== 'Annulé' && new Date(o.created_at) >= todayStart)
      .reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    
    const monthRevenue = allOrders
      .filter(o => o.status !== 'Annulé' && new Date(o.created_at) >= monthStart)
      .reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

    // Low stock alerts
    const lowStockProducts = [];
    (products || []).forEach(p => {
      (p.colors || []).forEach(c => {
        if ((c.stock || 0) <= lowStockThreshold) {
          lowStockProducts.push({
            productName: p.name,
            color: c.name,
            stock: c.stock || 0
          });
        }
      });
    });

    res.json({
      totalOrders: allOrders.length,
      totalRevenue,
      productsCount: (products || []).length,
      pendingOrders,
      completedOrders,
      cancelledOrders,
      todayRevenue,
      monthRevenue,
      lowStockProducts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- PRODUCTS (admin CRUD) ----------
app.post('/api/products', admin, upload.array('images', 25), async (req, res) => {
  try {
    const {
      name, description, category, basePrice, discount,
      isFeatured, sizes, colors, seoTitle, seoDescription,
      promotionStartDate, promotionEndDate
    } = req.body;

    // Upload images vers Supabase Storage
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImageToStorage(file);
        if (url) uploadedImages.push(url);
      }
    }

    // Distribuer les images entre les couleurs
    let parsedColors = [];
    try { parsedColors = JSON.parse(colors || '[]'); } catch(e) { parsedColors = []; }
    
    if (uploadedImages.length > 0 && parsedColors.length > 0) {
      const imagesPerColor = Math.ceil(uploadedImages.length / parsedColors.length);
      parsedColors = parsedColors.map((c, idx) => ({
        ...c,
        images: [
          ...(c.images || []),
          ...uploadedImages.slice(idx * imagesPerColor, (idx + 1) * imagesPerColor)
        ]
      }));
    }

    let parsedSizes = [];
    try { parsedSizes = JSON.parse(sizes || '[]'); } catch(e) { parsedSizes = []; }

    const insertData = {
      name,
      description,
      category,
      base_price: parseFloat(basePrice) || 0,
      discount: parseFloat(discount) || 0,
      is_featured: isFeatured === 'true' || isFeatured === true,
      sizes: parsedSizes,
      colors: parsedColors,
      seo_title: seoTitle || null,
      seo_description: seoDescription || null,
      promotion_start: promotionStartDate ? new Date(promotionStartDate) : null,
      promotion_end: promotionEndDate ? new Date(promotionEndDate) : null
    };

    const { data, error } = await supabase
      .from('products')
      .insert(insertData)
      .select()
      .single();
    
    if (error) throw error;
    res.json(formatProduct(data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', admin, upload.array('images', 25), async (req, res) => {
  try {
    const {
      name, description, category, basePrice, discount,
      isFeatured, sizes, colors, seoTitle, seoDescription,
      promotionStartDate, promotionEndDate
    } = req.body;

    // Récupérer le produit existant
    const { data: existing, error: eErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (eErr || !existing) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }

    // Upload nouvelles images
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImageToStorage(file);
        if (url) uploadedImages.push(url);
      }
    }

    let parsedColors = [];
    try { parsedColors = JSON.parse(colors || '[]'); } catch(e) { parsedColors = []; }

    // Distribuer les nouvelles images entre les couleurs (append)
    if (uploadedImages.length > 0 && parsedColors.length > 0) {
      const imagesPerColor = Math.ceil(uploadedImages.length / parsedColors.length);
      parsedColors = parsedColors.map((c, idx) => ({
        ...c,
        images: [
          ...(c.images || []),
          ...uploadedImages.slice(idx * imagesPerColor, (idx + 1) * imagesPerColor)
        ]
      }));
    } else if (parsedColors.length > 0) {
      // Conserver les images existantes si pas de nouvel upload
      parsedColors = parsedColors.map(c => ({
        ...c,
        images: c.images || []
      }));
    }

    let parsedSizes = [];
    try { parsedSizes = JSON.parse(sizes || '[]'); } catch(e) { parsedSizes = []; }

    // Gérer promotion : si dates vides, supprimer la promotion
    let promotionStart = null;
    let promotionEnd = null;
    if (promotionStartDate && promotionEndDate && promotionStartDate !== '' && promotionEndDate !== '') {
      promotionStart = new Date(promotionStartDate);
      promotionEnd = new Date(promotionEndDate);
    }

    const updateData = {
      name,
      description,
      category,
      base_price: parseFloat(basePrice) || 0,
      discount: parseFloat(discount) || 0,
      is_featured: isFeatured === 'true' || isFeatured === true,
      sizes: parsedSizes,
      colors: parsedColors,
      seo_title: seoTitle || null,
      seo_description: seoDescription || null,
      promotion_start: promotionStart,
      promotion_end: promotionEnd,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(formatProduct(data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', admin, async (req, res) => {
  try {
    // Récupérer pour supprimer les images du storage
    const { data: product } = await supabase
      .from('products')
      .select('colors')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id);
    
    if (error) throw error;

    // Supprimer les images du storage (non-bloquant)
    if (product && product.colors) {
      for (const color of product.colors) {
        if (color.images && color.images.length > 0) {
          for (const imgUrl of color.images) {
            if (imgUrl.includes('/storage/v1/object/public/')) {
              try {
                const urlObj = new URL(imgUrl);
                const pathParts = urlObj.pathname.split(`/object/public/${STORAGE_BUCKET}/`)[1];
                if (pathParts) {
                  await supabase.storage.from(STORAGE_BUCKET).remove([pathParts]);
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ORDERS (admin) ----------
app.get('/api/orders', admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(formatOrder));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', admin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Nouveau', 'Confirmé', 'En préparation', 'Expédié', 'Livré', 'Annulé'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    // Si annulation, restaurer le stock
    if (status === 'Annulé') {
      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('id', req.params.id)
        .single();
      
      if (order && order.status !== 'Annulé' && order.items) {
        for (const item of order.items) {
          const { data: product } = await supabase
            .from('products')
            .select('colors')
            .eq('id', item.productId)
            .single();
          
          if (product) {
            const colors = product.colors || [];
            const colorIdx = colors.findIndex(c => c.name === item.color);
            if (colorIdx !== -1) {
              colors[colorIdx].stock = (colors[colorIdx].stock || 0) + item.quantity;
              await supabase
                .from('products')
                .update({ colors, updated_at: new Date().toISOString() })
                .eq('id', item.productId);
            }
          }
        }
      }
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(formatOrder(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EXPORT ORDERS TO EXCEL (إضافة تصدير البيانات) ----------
// استدعاء المكتبة الموجودة بالفعل في مشروعك
const ExcelJS = require('exceljs');

// الراوت المتوافق تماماً مع طلب لوحة التحكم ومكتبة exceljs
app.get('/api/export/excel', admin, async (req, res) => {
  try {
    // 1. جلب الطلبات من قاعدة البيانات مرتبة من الأحدث للأقدم
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 2. إنشاء كتاب العمل والورقة باستخدام ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Commandes AURA');

    // 3. تحديد أسماء الأعمدة وعرضها تلقائياً داخل ملف الإكسيل
    worksheet.columns = [
      { header: 'Numéro de Commande', key: 'order_number', width: 25 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Nom Client', key: 'customer_name', width: 20 },
      { header: 'Téléphone', key: 'customer_phone', width: 15 },
      { header: 'Email', key: 'customer_email', width: 25 },
      { header: 'Gouvernorat', key: 'city', width: 15 },
      { header: 'Adresse', key: 'address', width: 30 },
      { header: 'Sous-total (TND)', key: 'subtotal', width: 18 },
      { header: 'Livraison (TND)', key: 'delivery_fee', width: 18 },
      { header: 'Remise (TND)', key: 'coupon_discount', width: 15 },
      { header: 'Total Global (TND)', key: 'total', width: 18 },
      { header: 'Statut', key: 'status', width: 15 },
      { header: 'Notes', key: 'notes', width: 30 }
    ];

    // 4. تعبئة البيانات في الأسطر
    if (!orders || orders.length === 0) {
      worksheet.addRow({ order_number: 'Aucune commande disponible' });
    } else {
      orders.forEach(order => {
        worksheet.addRow({
          order_number: order.order_number,
          date: order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : '',
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_email: order.customer_email || '',
          city: order.city || '',
          address: order.address || '',
          subtotal: order.subtotal || 0,
          delivery_fee: order.delivery_fee || 0,
          coupon_discount: order.coupon_discount || 0,
          total: order.total || 0,
          status: order.status || 'Nouveau',
          notes: order.notes || ''
        });
      });
    }

    // تنسيق السطر الأول (العناوين) ليكون بخط عريض (Bold) ومميز
    worksheet.getRow(1).font = { bold: true };

    // 5. إعداد الهيدرز وإرسال الملف مباشرة للمتصفح للتحميل
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Commandes_AURA_${new Date().toISOString().split('T')[0]}.xlsx`);

    // كتابة الملف مباشرة في الـ Response
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Erreur ExcelJS:', err.message);
    res.status(500).json({ error: 'Erreur lors de la génération du fichier Excel' });
  }
});
// ---------- CATEGORIES (admin CRUD) ----------
app.post('/api/categories', admin, async (req, res) => {
  try {
    let { name, slug } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    
    if (!slug) {
      slug = name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const { data, error } = await supabase
      .from('categories')
      .insert({ name, slug })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Catégorie déjà existante' });
      }
      throw error;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', admin, async (req, res) => {
  try {
    const { name, slug } = req.body;
    const { data, error } = await supabase
      .from('categories')
      .update({ name, slug })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- COUPONS (admin CRUD) ----------
app.get('/api/coupons', admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(formatCoupon));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/coupons', admin, async (req, res) => {
  try {
    const { code, discount, discountType, minOrder, expirationDate, isActive } = req.body;
    if (!code || discount == null) {
      return res.status(400).json({ error: 'Code et remise requis' });
    }

    const { data, error } = await supabase
      .from('coupons')
      .insert({
        code: code.toUpperCase(),
        discount: parseFloat(discount),
        discount_type: discountType || 'percentage',
        min_order: parseFloat(minOrder) || 0,
        expiration_date: expirationDate ? new Date(expirationDate) : null,
        is_active: isActive !== false
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Code déjà existant' });
      }
      throw error;
    }
    res.json(formatCoupon(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/coupons/:id', admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('coupons')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- REVIEWS (admin) ----------
app.delete('/api/reviews/:id', admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- BANNERS (admin CRUD) ----------
app.post('/api/banners', admin, upload.single('image'), async (req, res) => {
  try {
    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadImageToStorage(req.file);
    }

    const { title, subtitle, linkUrl, isActive, orderNum } = req.body;
    const { data, error } = await supabase
      .from('banners')
      .insert({
        title,
        subtitle,
        image_url: imageUrl,
        link_url: linkUrl,
        is_active: isActive !== false,
        order_num: parseInt(orderNum) || 0
      })
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/banners/:id', admin, upload.single('image'), async (req, res) => {
  try {
    const { title, subtitle, linkUrl, isActive, orderNum } = req.body;
    const update = {
      title, subtitle,
      link_url: linkUrl,
      is_active: isActive !== false,
      order_num: parseInt(orderNum) || 0
    };

    if (req.file) {
      update.image_url = await uploadImageToStorage(req.file);
    }

    const { data, error } = await supabase
      .from('banners')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/banners/:id', admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('banners')
      .delete()
      .eq('id', req.params.id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SETTINGS (admin update) (إضافة تعديل الإعدادات) ----------
app.put('/api/settings', admin, async (req, res) => {
  try {
    const { deliveryFee, lowStockThreshold, whatsapp, email, instagram, facebook, companyAddress } = req.body;
    
    const { data, error } = await supabase
      .from('settings')
      .update({
        delivery_fee: parseFloat(deliveryFee) || 15,
        low_stock_threshold: parseInt(lowStockThreshold) || 5,
        whatsapp,
        email,
        instagram,
        facebook,
        company_address: companyAddress
      })
      .eq('id', 1)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ==================== SERVER START ===================
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Born To Shine Backend (Supabase Edition) running on port ${PORT}`);
});
