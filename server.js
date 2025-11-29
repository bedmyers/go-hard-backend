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
  if (req.originalUrl === '/webhooks/stripe') return next();
  return express.json()(req, res, next);
});
app.use(cors());
app.use(morgan("dev"));

const prisma = new PrismaClient();

// Global error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Health check route
app.get("/", (req, res) => {
  res.send("Go Hard API is running! 🚀");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ============================================
// USER REGISTRATION & LOGIN
// ============================================

app.post("/users/register", async (req, res) => {
  const { email, name, password, userType = "CUSTOMER" } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        userType
      },
    });
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    res.json({ 
      token, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        userType: user.userType
      }
    });
  } catch (error) {
    console.error("Error in /users/register:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ 
      token, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        userType: user.userType
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get user profile
app.get("/users/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        userType: true,
        bio: true,
        services: true,
        portfolioUrls: true,
        location: true,
        phoneNumber: true,
        stripeAccountId: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
app.patch("/users/me", authenticateToken, async (req, res) => {
  const { name, bio, services, portfolioUrls, location, phoneNumber } = req.body;
  
  try {
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(name && { name }),
        ...(bio !== undefined && { bio }),
        ...(services && { services }),
        ...(portfolioUrls && { portfolioUrls }),
        ...(location !== undefined && { location }),
        ...(phoneNumber !== undefined && { phoneNumber })
      },
      select: {
        id: true,
        email: true,
        name: true,
        userType: true,
        bio: true,
        services: true,
        portfolioUrls: true,
        location: true,
        phoneNumber: true
      }
    });
    
    res.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STRIPE CONNECT (Vendor Onboarding)
// ============================================

// Start Connect onboarding for vendor
app.post("/stripe/connect/onboard", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: req.user.userId } 
    });
    
    if (user.userType === 'CUSTOMER') {
      return res.status(403).json({ 
        error: "Only vendors can onboard to Stripe Connect" 
      });
    }
    
    let accountId = user.stripeAccountId;
    
    // Create Stripe Connect account if vendor doesn't have one
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_type: 'individual',
        metadata: {
          userId: String(user.id),
          userEmail: user.email
        }
      });
      
      accountId = account.id;
      
      // Save to database
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeAccountId: accountId }
      });
    }
    
    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/vendor/onboarding/refresh`,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/vendor/onboarding/complete`,
      type: 'account_onboarding'
    });
    
    res.json({ 
      url: accountLink.url,
      accountId 
    });
  } catch (error) {
    console.error("Connect onboarding error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Check Connect account status
app.get("/stripe/connect/status", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: req.user.userId } 
    });
    
    if (!user.stripeAccountId) {
      return res.json({ 
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false
      });
    }
    
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    
    res.json({
      connected: true,
      accountId: user.stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requirements: account.requirements
    });
  } catch (error) {
    console.error("Error checking Connect status:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Connect dashboard link (for vendor to manage payouts/settings)
app.get("/stripe/connect/dashboard", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: req.user.userId } 
    });
    
    if (!user.stripeAccountId) {
      return res.status(400).json({ 
        error: "No Stripe account connected" 
      });
    }
    
    const loginLink = await stripe.accounts.createLoginLink(
      user.stripeAccountId
    );
    
    res.json({ url: loginLink.url });
  } catch (error) {
    console.error("Error creating dashboard link:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PROJECT ENDPOINTS
// ============================================

// Create a new project
app.post("/projects", authenticateToken, async (req, res) => {
  const { title, description, totalBudget, eventDate, location, pinterestBoard } = req.body;
  
  try {
    const project = await prisma.project.create({
      data: {
        title,
        description,
        totalBudget: totalBudget ? Number(totalBudget) : null,
        eventDate: eventDate ? new Date(eventDate) : null,
        location,
        pinterestBoard,
        customerId: req.user.userId
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        vendors: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true }
            },
            escrow: {
              include: { milestones: true }
            }
          }
        }
      }
    });
    
    res.json(project);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all projects for current user (as customer or vendor)
app.get("/projects", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get projects where user is customer
    const ownedProjects = await prisma.project.findMany({
      where: { customerId: userId },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        vendors: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true, services: true }
            },
            escrow: {
              include: { milestones: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Get projects where user is a vendor
    const vendorProjects = await prisma.projectVendor.findMany({
      where: { vendorId: userId },
      include: {
        project: {
          include: {
            customer: {
              select: { id: true, name: true, email: true }
            },
            vendors: {
              include: {
                vendor: {
                  select: { id: true, name: true, email: true }
                }
              }
            }
          }
        },
        escrow: {
          include: { milestones: true }
        }
      }
    });
    
    res.json({
      ownedProjects,
      vendorProjects: vendorProjects.map(pv => ({
        ...pv.project,
        myVendorRole: {
          id: pv.id,
          role: pv.role,
          amountCents: pv.amountCents,
          status: pv.status,
          escrow: pv.escrow
        }
      }))
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get single project by ID
app.get("/projects/:id", authenticateToken, async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const userId = req.user.userId;
    
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        vendors: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true, services: true, location: true }
            },
            escrow: {
              include: { milestones: true }
            }
          }
        }
      }
    });
    
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Check if user has access (is customer or is a vendor on this project)
    const isCustomer = project.customerId === userId;
    const isVendor = project.vendors.some(v => v.vendorId === userId);
    
    if (!isCustomer && !isVendor) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update project
app.patch("/projects/:id", authenticateToken, async (req, res) => {
  const { title, description, totalBudget, eventDate, location, pinterestBoard, status } = req.body;
  const projectId = Number(req.params.id);
  
  try {
    // Check ownership
    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing || existing.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(totalBudget !== undefined && { totalBudget: Number(totalBudget) }),
        ...(eventDate !== undefined && { eventDate: eventDate ? new Date(eventDate) : null }),
        ...(location !== undefined && { location }),
        ...(pinterestBoard !== undefined && { pinterestBoard }),
        ...(status && { status })
      },
      include: {
        vendors: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true }
            }
          }
        }
      }
    });
    
    res.json(project);
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PROJECT VENDOR ENDPOINTS
// ============================================

// Add vendor to project
app.post("/projects/:projectId/vendors", authenticateToken, async (req, res) => {
  const { vendorId, vendorEmail, role, description, amountCents, dueDate } = req.body;
  const projectId = Number(req.params.projectId);
  
  try {
    // Check project ownership
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    let finalVendorId = vendorId;
    
    // If vendorEmail provided instead of vendorId, find or create vendor
    if (!finalVendorId && vendorEmail) {
      let vendor = await prisma.user.findUnique({ where: { email: vendorEmail } });
      
      if (!vendor) {
        // Create placeholder vendor account
        vendor = await prisma.user.create({
          data: {
            email: vendorEmail,
            name: vendorEmail.split('@')[0],
            password: "", // They'll set password when they accept
            userType: "VENDOR"
          }
        });
      }
      
      finalVendorId = vendor.id;
    }
    
    if (!finalVendorId) {
      return res.status(400).json({ error: "vendorId or vendorEmail required" });
    }
    
    const projectVendor = await prisma.projectVendor.create({
      data: {
        projectId,
        vendorId: finalVendorId,
        role,
        description,
        amountCents: Number(amountCents),
        dueDate: dueDate ? new Date(dueDate) : null
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, services: true }
        }
      }
    });
    
    res.json(projectVendor);
  } catch (error) {
    console.error("Error adding vendor to project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update project vendor
app.patch("/projects/:projectId/vendors/:vendorId", authenticateToken, async (req, res) => {
  const { role, description, amountCents, dueDate, status } = req.body;
  const projectId = Number(req.params.projectId);
  const vendorId = Number(req.params.vendorId);
  
  try {
    // Check ownership or vendor access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const isCustomer = project && project.customerId === req.user.userId;
    const isVendor = vendorId === req.user.userId;
    
    if (!isCustomer && !isVendor) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const projectVendor = await prisma.projectVendor.findFirst({
      where: { projectId, vendorId }
    });
    
    if (!projectVendor) {
      return res.status(404).json({ error: "Project vendor not found" });
    }
    
    const updated = await prisma.projectVendor.update({
      where: { id: projectVendor.id },
      data: {
        ...(role && { role }),
        ...(description !== undefined && { description }),
        ...(amountCents !== undefined && { amountCents: Number(amountCents) }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(status && { status })
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true }
        }
      }
    });
    
    res.json(updated);
  } catch (error) {
    console.error("Error updating project vendor:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ESCROW ENDPOINTS (WITH STRIPE CONNECT)
// ============================================

// Create escrow for a project vendor
app.post("/project-vendors/:projectVendorId/escrow", authenticateToken, async (req, res) => {
  const { milestones = [] } = req.body;
  const projectVendorId = Number(req.params.projectVendorId);
  
  try {
    // Get the project vendor
    const projectVendor = await prisma.projectVendor.findUnique({
      where: { id: projectVendorId },
      include: { 
        project: true,
        vendor: true 
      }
    });
    
    if (!projectVendor) {
      return res.status(404).json({ error: "Project vendor not found" });
    }
    
    // Check ownership
    if (projectVendor.project.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Check if escrow already exists
    const existing = await prisma.escrow.findUnique({
      where: { projectVendorId }
    });
    
    if (existing) {
      return res.status(400).json({ error: "Escrow already exists for this vendor" });
    }
    
    /*// Verify vendor has completed Stripe Connect onboarding
    if (!projectVendor.vendor.stripeAccountId) {
      return res.status(400).json({ 
        error: "Vendor must complete Stripe Connect onboarding before escrow can be created" 
      });
    }*/
    
    // Verify vendor account is ready to receive payments
    /*const vendorAccount = await stripe.accounts.retrieve(projectVendor.vendor.stripeAccountId);
    if (!vendorAccount.charges_enabled) {
      return res.status(400).json({ 
        error: "Vendor's Stripe account is not yet enabled to receive payments" 
      });
    }*/
    
    // Prepare milestones
    const milestoneCreates = milestones.map((m, idx) => {
      const cents = Number(m.amountCents);
      if (!Number.isFinite(cents) || cents <= 0) {
        throw new Error(`Invalid milestone[${idx}] amount`);
      }
      
      return {
        amountCents: cents,
        description: m.description || null,
        releaseConditions: m.releaseConditions || null,
        dueDate: m.dueDate ? new Date(m.dueDate) : null,
        released: false
      };
    });
    
    // Create escrow
    const escrow = await prisma.escrow.create({
      data: {
        projectVendorId,
        buyerId: projectVendor.project.customerId,
        sellerId: projectVendor.vendorId,
        amountCents: projectVendor.amountCents,
        status: "PENDING",
        milestones: { create: milestoneCreates }
      },
      include: {
        milestones: true,
        buyer: { select: { id: true, name: true, email: true } },
        seller: { select: { id: true, name: true, email: true, stripeAccountId: true } }
      }
    });
    
    res.json(escrow);
  } catch (error) {
    console.error("Error creating escrow:", error);
    res.status(500).json({ error: error.message });
  }
});

// Fund escrow via Stripe (with Connect)
app.post("/escrow/:escrowId/fund", authenticateToken, async (req, res) => {
  const { paymentMethodId } = req.body;
  const escrowId = Number(req.params.escrowId);
  const userId = req.user.userId;

  try {
    const escrow = await prisma.escrow.findUnique({ 
      where: { id: escrowId },
      include: { 
        projectVendor: { 
          include: { 
            project: true,
            vendor: true 
          } 
        },
        seller: true
      }
    });
    
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    
    // Check ownership
    if (escrow.projectVendor.project.customerId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Verify vendor has Stripe account
    if (!escrow.seller.stripeAccountId) {
      return res.status(400).json({ 
        error: "Vendor must complete Stripe Connect onboarding" 
      });
    }

    const amount = Number(escrow.amountCents);
    const platformFee = Math.round(amount * 0.025); // 2.5% platform fee
    const idempotencyKey = `fund_${escrowId}_${userId}`;

    // Create payment intent with destination charge (money held in platform account)
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual", // Hold the funds
      application_fee_amount: platformFee,
      transfer_data: {
        destination: escrow.seller.stripeAccountId
      },
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { 
        escrowId: String(escrowId), 
        buyerId: String(userId),
        projectVendorId: String(escrow.projectVendorId)
      },
    }, { idempotencyKey });

    await prisma.escrow.update({
      where: { id: escrowId },
      data: {
        stripePaymentIntentId: intent.id,
        status: intent.status === "requires_capture" ? "AUTHORIZED" : escrow.status,
      },
    });
    
    // Update ProjectVendor status
    if (intent.status === "requires_capture") {
      await prisma.projectVendor.update({
        where: { id: escrow.projectVendorId },
        data: { status: "PAID" }
      });
    }

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
        platformFee,
      });
    }
    
    return res.json({ status: intent.status, paymentIntentId: intent.id });
  } catch (error) {
    console.error("Fund error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Release milestone payment (automatically transfers to vendor via Connect)
app.post("/escrow/:escrowId/milestone/:milestoneId/release", authenticateToken, async (req, res) => {
  const escrowId = Number(req.params.escrowId);
  const milestoneId = Number(req.params.milestoneId);
  const idempotencyKey = `release_${milestoneId}`;

  try {
    const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone || milestone.released) {
      return res.status(400).json({ error: "Invalid or already released milestone" });
    }

    const escrow = await prisma.escrow.findUnique({ 
      where: { id: escrowId },
      include: {
        projectVendor: {
          include: { 
            project: true,
            vendor: true 
          }
        }
      }
    });
    
    if (!escrow || !escrow.stripePaymentIntentId) {
      return res.status(404).json({ error: "Escrow not found or not funded" });
    }
    
    // Check ownership
    if (escrow.projectVendor.project.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const pi = await stripe.paymentIntents.retrieve(escrow.stripePaymentIntentId);
    if (pi.status !== "requires_capture") {
      return res.status(400).json({ error: `Payment not capturable: ${pi.status}` });
    }

    const amountToCapture = Number(milestone.amountCents);
    if (pi.amount_capturable < amountToCapture) {
      return res.status(400).json({ error: "Amount exceeds remaining capturable" });
    }

    // Capture payment - this automatically transfers to vendor via Connect
    const cap = await stripe.paymentIntents.capture(
      pi.id,
      { amount_to_capture: amountToCapture },
      { idempotencyKey }
    );

    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { released: true }
    });

    // If all milestones released, mark escrow COMPLETE
    const remaining = await prisma.milestone.count({
      where: { escrowId, released: false }
    });
    
    if (remaining === 0) {
      await prisma.escrow.update({ 
        where: { id: escrowId }, 
        data: { status: "COMPLETE" } 
      });
      
      await prisma.projectVendor.update({
        where: { id: escrow.projectVendorId },
        data: { status: "COMPLETED" }
      });
    }

    res.json({ 
      success: true, 
      paymentIntentId: cap.id, 
      amountCaptured: amountToCapture, 
      remainingCapturable: cap.amount_capturable,
      message: "Payment captured and transferred to vendor"
    });
  } catch (error) {
    console.error("Release error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get escrow details
app.get("/escrow/:escrowId", authenticateToken, async (req, res) => {
  const escrowId = Number(req.params.escrowId);
  
  try {
    const escrow = await prisma.escrow.findUnique({
      where: { id: escrowId },
      include: {
        milestones: true,
        buyer: { select: { id: true, name: true, email: true } },
        seller: { select: { id: true, name: true, email: true, stripeAccountId: true } },
        projectVendor: {
          include: {
            project: { select: { id: true, title: true, customerId: true } },
            vendor: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });
    
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    
    // Check access
    const userId = req.user.userId;
    const hasAccess = 
      escrow.buyerId === userId || 
      escrow.sellerId === userId ||
      escrow.projectVendor.project.customerId === userId;
    
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(escrow);
  } catch (error) {
    console.error("Error fetching escrow:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VENDOR SEARCH
// ============================================

app.get("/vendors/search", async (req, res) => {
  const { query, service, location } = req.query;
  
  try {
    const whereClause = {
      userType: { in: ['VENDOR', 'BOTH'] },
      ...(query && {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { bio: { contains: query, mode: 'insensitive' } }
        ]
      }),
      ...(service && { services: { has: service } }),
      ...(location && { location: { contains: location, mode: 'insensitive' } })
    };
    
    const vendors = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        bio: true,
        services: true,
        portfolioUrls: true,
        location: true
      }
    });
    
    res.json(vendors);
  } catch (error) {
    console.error("Error searching vendors:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get vendor profile
app.get("/vendors/:id", async (req, res) => {
  const vendorId = Number(req.params.id);
  
  try {
    const vendor = await prisma.user.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        email: true,
        bio: true,
        services: true,
        portfolioUrls: true,
        location: true,
        phoneNumber: true,
        projectVendorRoles: {
          where: { status: 'COMPLETED' },
          select: {
            id: true,
            role: true,
            project: {
              select: {
                title: true,
                eventDate: true
              }
            }
          },
          take: 10
        }
      }
    });
    
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    
    res.json(vendor);
  } catch (error) {
    console.error("Error fetching vendor:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// RFP ENDPOINTS
// ============================================

// Create RFP for a project
app.post("/projects/:projectId/rfps", authenticateToken, async (req, res) => {
  const { title, description, budget, deadline } = req.body;
  const projectId = Number(req.params.projectId);
  
  try {
    // Check project ownership
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const rfp = await prisma.rFP.create({
      data: {
        projectId,
        customerId: req.user.userId,
        title,
        description,
        budget: budget ? Number(budget) : null,
        deadline: deadline ? new Date(deadline) : null
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        project: {
          select: { id: true, title: true }
        }
      }
    });
    
    res.json(rfp);
  } catch (error) {
    console.error("Error creating RFP:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all RFPs for a project
app.get("/projects/:projectId/rfps", authenticateToken, async (req, res) => {
  const projectId = Number(req.params.projectId);
  
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Check access
    const hasAccess = project.customerId === req.user.userId;
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const rfps = await prisma.rFP.findMany({
      where: { projectId },
      include: {
        bids: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true, services: true, location: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(rfps);
  } catch (error) {
    console.error("Error fetching RFPs:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get single RFP with all bids
app.get("/rfps/:rfpId", authenticateToken, async (req, res) => {
  const rfpId = Number(req.params.rfpId);
  
  try {
    const rfp = await prisma.rFP.findUnique({
      where: { id: rfpId },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        project: {
          select: { id: true, title: true, description: true, eventDate: true, location: true }
        },
        bids: {
          include: {
            vendor: {
              select: { 
                id: true, 
                name: true, 
                email: true, 
                bio: true,
                services: true, 
                portfolioUrls: true,
                location: true 
              }
            }
          },
          orderBy: { amount: 'asc' } // Lowest bids first
        }
      }
    });
    
    if (!rfp) {
      return res.status(404).json({ error: "RFP not found" });
    }
    
    // Check access (customer or vendor who submitted bid)
    const isCustomer = rfp.customerId === req.user.userId;
    const hasBid = rfp.bids.some(b => b.vendorId === req.user.userId);
    
    if (!isCustomer && !hasBid) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(rfp);
  } catch (error) {
    console.error("Error fetching RFP:", error);
    res.status(500).json({ error: error.message });
  }
});

// Browse open RFPs (for vendors to find work)
app.get("/rfps/browse", authenticateToken, async (req, res) => {
  const { service } = req.query;
  
  try {
    const rfps = await prisma.rFP.findMany({
      where: {
        status: 'OPEN',
        deadline: {
          gte: new Date() // Only future deadlines
        }
      },
      include: {
        customer: {
          select: { id: true, name: true }
        },
        project: {
          select: { id: true, title: true, eventDate: true, location: true }
        },
        bids: {
          select: { id: true } // Just count
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    
    res.json(rfps.map(rfp => ({
      ...rfp,
      bidCount: rfp.bids.length
    })));
  } catch (error) {
    console.error("Error browsing RFPs:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update RFP
app.patch("/rfps/:rfpId", authenticateToken, async (req, res) => {
  const { title, description, budget, deadline, status } = req.body;
  const rfpId = Number(req.params.rfpId);
  
  try {
    const existing = await prisma.rFP.findUnique({ where: { id: rfpId } });
    if (!existing || existing.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const rfp = await prisma.rFP.update({
      where: { id: rfpId },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(budget !== undefined && { budget: budget ? Number(budget) : null }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(status && { status })
      },
      include: {
        bids: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true }
            }
          }
        }
      }
    });
    
    res.json(rfp);
  } catch (error) {
    console.error("Error updating RFP:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BID ENDPOINTS
// ============================================

// Submit a bid on an RFP
app.post("/rfps/:rfpId/bids", authenticateToken, async (req, res) => {
  const { amount, proposal } = req.body;
  const rfpId = Number(req.params.rfpId);
  
  try {
    // Check RFP exists and is open
    const rfp = await prisma.rFP.findUnique({ where: { id: rfpId } });
    if (!rfp) {
      return res.status(404).json({ error: "RFP not found" });
    }
    
    if (rfp.status !== 'OPEN') {
      return res.status(400).json({ error: "RFP is not open for bids" });
    }
    
    // Check user is a vendor
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (user.userType === 'CUSTOMER') {
      return res.status(403).json({ error: "Only vendors can submit bids" });
    }
    
    // Check if vendor already bid
    const existingBid = await prisma.bid.findUnique({
      where: {
        rfpId_vendorId: {
          rfpId,
          vendorId: req.user.userId
        }
      }
    });
    
    if (existingBid) {
      return res.status(400).json({ error: "You have already submitted a bid for this RFP" });
    }
    
    const bid = await prisma.bid.create({
      data: {
        rfpId,
        vendorId: req.user.userId,
        amount: Number(amount),
        proposal
      },
      include: {
        vendor: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            bio: true,
            services: true,
            portfolioUrls: true,
            location: true
          }
        },
        rfp: {
          include: {
            project: {
              select: { id: true, title: true }
            }
          }
        }
      }
    });
    
    res.json(bid);
  } catch (error) {
    console.error("Error submitting bid:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update a bid
app.patch("/bids/:bidId", authenticateToken, async (req, res) => {
  const { amount, proposal } = req.body;
  const bidId = Number(req.params.bidId);
  
  try {
    const existing = await prisma.bid.findUnique({ 
      where: { id: bidId },
      include: { rfp: true }
    });
    
    if (!existing || existing.vendorId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    if (existing.rfp.status !== 'OPEN') {
      return res.status(400).json({ error: "Cannot update bid - RFP is no longer open" });
    }
    
    if (existing.status !== 'SUBMITTED') {
      return res.status(400).json({ error: "Cannot update bid after it has been accepted/rejected" });
    }
    
    const bid = await prisma.bid.update({
      where: { id: bidId },
      data: {
        ...(amount !== undefined && { amount: Number(amount) }),
        ...(proposal !== undefined && { proposal })
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true }
        }
      }
    });
    
    res.json(bid);
  } catch (error) {
    console.error("Error updating bid:", error);
    res.status(500).json({ error: error.message });
  }
});

// Accept a bid (creates ProjectVendor)
app.post("/bids/:bidId/accept", authenticateToken, async (req, res) => {
  const bidId = Number(req.params.bidId);
  
  try {
    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        rfp: {
          include: { project: true }
        },
        vendor: true
      }
    });
    
    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }
    
    // Check ownership
    if (bid.rfp.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    if (bid.rfp.status !== 'OPEN') {
      return res.status(400).json({ error: "RFP is no longer open" });
    }
    
    // Create ProjectVendor from the bid
    const projectVendor = await prisma.projectVendor.create({
      data: {
        projectId: bid.rfp.projectId,
        vendorId: bid.vendorId,
        role: bid.rfp.title, // Use RFP title as role
        description: bid.proposal,
        amountCents: bid.amount,
        status: 'ACCEPTED'
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true }
        }
      }
    });
    
    // Update bid status
    await prisma.bid.update({
      where: { id: bidId },
      data: { status: 'ACCEPTED' }
    });
    
    // Update RFP status
    await prisma.rFP.update({
      where: { id: bid.rfpId },
      data: { status: 'AWARDED' }
    });
    
    // Reject all other bids
    await prisma.bid.updateMany({
      where: {
        rfpId: bid.rfpId,
        id: { not: bidId },
        status: 'SUBMITTED'
      },
      data: { status: 'REJECTED' }
    });
    
    res.json({
      projectVendor,
      message: "Bid accepted and vendor added to project"
    });
  } catch (error) {
    console.error("Error accepting bid:", error);
    res.status(500).json({ error: error.message });
  }
});

// Reject a bid
app.post("/bids/:bidId/reject", authenticateToken, async (req, res) => {
  const bidId = Number(req.params.bidId);
  
  try {
    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
      include: { rfp: true }
    });
    
    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }
    
    // Check ownership
    if (bid.rfp.customerId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    await prisma.bid.update({
      where: { id: bidId },
      data: { status: 'REJECTED' }
    });
    
    res.json({ message: "Bid rejected" });
  } catch (error) {
    console.error("Error rejecting bid:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STRIPE WEBHOOKS
// ============================================

app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle Connect account events
  if (event.type === "account.updated") {
    const account = event.data.object;
    // Update user's Connect status in database if needed
    console.log("Connect account updated:", account.id);
  }
  
  if (event.type === "payment_intent.amount_capturable_updated") {
    // Update DB if needed
  }
  
  if (event.type === "payment_intent.canceled") {
    // Mark escrow as canceled
  }
  
  res.json({ received: true });
});

// ============================================
// STANDALONE RFP (no project required)
// ============================================

// Create RFP without a project
app.post("/rfps", authenticateToken, async (req, res) => {
  const { title, description, budget, deadline, projectId } = req.body;
  
  try {
    // If projectId provided, verify ownership
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project || project.customerId !== req.user.userId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    
    const rfp = await prisma.rFP.create({
      data: {
        customerId: req.user.userId,
        projectId: projectId || null,
        title,
        description,
        budget: budget ? Number(budget) : null,
        deadline: deadline ? new Date(deadline) : null
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        project: {
          select: { id: true, title: true }
        }
      }
    });
    
    res.json(rfp);
  } catch (error) {
    console.error("Error creating RFP:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all RFPs for current user (across all projects + standalone)
app.get("/rfps/my", authenticateToken, async (req, res) => {
  try {
    const rfps = await prisma.rFP.findMany({
      where: { customerId: req.user.userId },
      include: {
        project: {
          select: { id: true, title: true }
        },
        bids: {
          include: {
            vendor: {
              select: { id: true, name: true, email: true, services: true, location: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(rfps);
  } catch (error) {
    console.error("Error fetching RFPs:", error);
    res.status(500).json({ error: error.message });
  }
});