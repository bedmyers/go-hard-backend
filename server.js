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
app.use(express.json());
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
app.post("/escrow/create", async (req, res) => {
  const { buyerId, sellerId, amount, milestones, title } = req.body;
  
  try {
const escrow = await prisma.escrow.create({
  data: {
    title, // ✅ new
    buyerId,
    sellerId,
    amount,
    status: "PENDING",
    milestones: { create: milestones },
  },
});
    res.json(escrow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fund escrow via Stripe
app.post("/escrow/fund", async (req, res) => {
  const { escrowId, paymentMethodId } = req.body;
  
  try {
    const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(escrow.amount * 100), // always multiply by 100 for cents
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never", // prevents Stripe from requiring a return_url
      },
    });
    
    await prisma.escrow.update({
      where: { id: escrowId },
      data: { stripePaymentIntentId: paymentIntent.id },
    });
    
    res.json({ success: true, paymentIntentId: paymentIntent.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Release milestone payment
app.post("/escrow/milestone/release", async (req, res) => {
  const { escrowId, milestoneId } = req.body;
  
  try {
    const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone || milestone.released) {
      return res.status(400).json({ error: "Invalid milestone" });
    }
    
    const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    
    // Capture the milestone amount
    await stripe.paymentIntents.capture(escrow.stripePaymentIntentId, {
      amount_to_capture: Math.round(milestone.amount * 100),
    });
    
    // Mark the milestone as released
    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { released: true },
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
