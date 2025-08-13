require("dotenv").config();

// Import dependencies
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { PrismaClient } = require("@prisma/client");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Import our custom auth middleware
const { authenticateToken } = require("./middleware/auth");

// Initialize app
const app = express();
app.use((req, res, next) => {
  if (req.originalUrl === '/webhooks/stripe') return next(); // let express.raw handle it
  return express.json()(req, res, next);
});
app.use(cors());
app.use(morgan("dev"));

const prisma = new PrismaClient();

// Example protected route
app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: `Hello user ${req.user.userId}` });
});

// Global error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Health check route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --------------------------------
//  USER REGISTRATION & LOGIN
// --------------------------------

// User registration
app.post("/users/register", async (req, res) => {
  const { email, name, password } = req.body;
  
  try {
    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword
      },
    });
    
    res.json(user);
  } catch (error) {
    console.error("Error in /users/register:", error); // <-- ADD THIS
    res.status(500).json({ error: error.message });
  }
});

// User login
app.post("/users/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("📥 LOGIN ATTEMPT:", { email, password });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      console.log("❌ No user found with email:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Password mismatch for:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    console.log("✅ Login successful:", user.email);
    res.json({ token, userId: user.id, email: user.email });
  } catch (error) {
    console.error("🔥 Login server error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --------------------------------
//  ESCROW & MILESTONE ENDPOINTS
// --------------------------------

// Create escrow transaction
app.post("/escrow/create", authenticateToken, async (req, res) => {
  try {
    const {
      title,
      buyerId,           // optional; we’ll default to the authed user
      sellerId,          // required
      amountCents,       // preferred: integer cents
      amount,            // fallback: dollars (number/string)
      milestones = []    // [{ amountCents } or { amount }]
    } = req.body;

    // Coerce/validate ids
    const buyerIdNum = Number(buyerId ?? req.user.userId);
    const sellerIdNum = Number(sellerId);

    // Coerce/validate total amount (prefer cents, fallback to dollars)
    const totalCents = Number.isFinite(Number(amountCents))
      ? Number(amountCents)
      : Math.round(Number(amount) * 100);

    if (!buyerIdNum || !sellerIdNum || !Number.isFinite(totalCents) || totalCents <= 0) {
      return res.status(400).json({
        error: "Invalid payload: buyerId/sellerId/amountCents (or amount) is required and must be > 0"
      });
    }

    // Coerce milestone cents; allow either amountCents or amount
    const milestoneCreates = milestones.map((m, idx) => {
      const cents = Number.isFinite(Number(m.amountCents))
        ? Number(m.amountCents)
        : Math.round(Number(m.amount) * 100);

      if (!Number.isFinite(cents) || cents <= 0) {
        throw new Error(`Invalid milestone[${idx}] amount`);
      }
      return { amountCents: cents, released: false };
    });

    const created = await prisma.escrow.create({
      data: {
        title: title ?? null,
        status: "PENDING",
        amountCents: totalCents,
        // IMPORTANT: connect relations (this satisfies Prisma's "buyer is missing")
        buyer:  { connect: { id: buyerIdNum } },
        seller: { connect: { id: sellerIdNum } },
        milestones: { create: milestoneCreates }
      },
      include: {
        milestones: true,
        // add these if your client needs them now:
        // buyer: true,
        // seller: true,
      }
    });

    return res.json(created);
  } catch (error) {
    console.error("Error in /escrow/create:", error);
    return res.status(500).json({ error: error.message });
  }
});


// Fund escrow via Stripe
app.post("/escrow/fund", authenticateToken, async (req, res) => {
  const { escrowId, paymentMethodId } = req.body;
  const userId = req.user.userId;

  try {
    const escrow = await prisma.escrow.findUnique({ where: { id: Number(escrowId) } });
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });

    const amount = Number(escrow.amountCents);
    const idempotencyKey = `fund_${escrowId}_${userId}`;

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual",                  // authorizes now, capture later
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { escrowId: String(escrowId), buyerId: String(userId) },
    }, { idempotencyKey });

    await prisma.escrow.update({
      where: { id: Number(escrowId) },
      data: {
        stripePaymentIntentId: intent.id,
        status: intent.status === "requires_capture" ? "AUTHORIZED" : escrow.status,
      },
    });

    if (intent.status === "requires_action") {
      return res.json({
        status: "requires_action",
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      });
    }
    if (intent.status === "requires_capture") {
      return res.json({
        status: "requires_capture",
        paymentIntentId: intent.id,
        amountCapturable: intent.amount_capturable,
      });
    }
    return res.json({ status: intent.status, paymentIntentId: intent.id });
  } catch (error) {
    console.error("fund error:", error);
    res.status(400).json({ message: error.message });
  }
});


// Release milestone payment
app.post("/escrow/milestone/release", authenticateToken, async (req, res) => {
  const { escrowId, milestoneId } = req.body;
  const idempotencyKey = `release_${milestoneId}`;

  try {
    const milestone = await prisma.milestone.findUnique({ where: { id: Number(milestoneId) } });
    if (!milestone || milestone.released) {
      return res.status(400).json({ error: "Invalid or already released milestone" });
    }

    const escrow = await prisma.escrow.findUnique({ where: { id: Number(escrowId) } });
    if (!escrow || !escrow.stripePaymentIntentId) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    const pi = await stripe.paymentIntents.retrieve(escrow.stripePaymentIntentId);
    if (pi.status !== "requires_capture") {
      return res.status(400).json({ error: `PI not capturable: ${pi.status}` });
    }

    const amountToCapture = Number(milestone.amountCents);
    if (pi.amount_capturable < amountToCapture) {
      return res.status(400).json({ error: "Amount exceeds remaining capturable" });
    }

    const cap = await stripe.paymentIntents.capture(
      pi.id,
      { amount_to_capture: amountToCapture },
      { idempotencyKey }
    );

    await prisma.milestone.update({
      where: { id: Number(milestoneId) },
      data: { released: true }
    });

    // If all milestones released, mark escrow COMPLETE
    const remaining = await prisma.milestone.count({
      where: { escrowId: Number(escrowId), released: false }
    });
    if (remaining === 0) {
      await prisma.escrow.update({ where: { id: Number(escrowId) }, data: { status: "COMPLETE" } });
    }

    res.json({ success: true, paymentIntentId: cap.id, amountCaptured: amountToCapture, remainingCapturable: cap.amount_capturable });
  } catch (error) {
    console.error("release error:", error);
    res.status(400).json({ error: error.message });
  }
});


app.get("/escrows/byUser", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all escrows where the user is buyer or seller
    const escrows = await prisma.escrow.findMany({
      where: {
        OR: [
          { buyerId: userId },
          { sellerId: userId }
        ]
      },
      include: {
        milestones: true
      }
    });

    res.json(escrows);
  } catch (error) {
    console.error("Error fetching escrows:", error);
    res.status(500).json({ error: error.message });
  }
});

// User search by name or email
app.get("/users/search", async (req, res) => {
  const query = req.query.query?.toLowerCase() || "";

  if (!query) return res.status(400).json({ error: "Missing query param" });

  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    res.json(users);
  } catch (error) {
    console.error("Error in /users/search:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

  if (event.type === "payment_intent.amount_capturable_updated") {
    // Update DB if you want to reflect capturable amounts
  }
  if (event.type === "payment_intent.canceled") {
    // Mark escrow as canceled/expired
  }
  res.json({ received: true });
});


