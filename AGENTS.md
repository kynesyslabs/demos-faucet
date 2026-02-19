# Demos Faucet - Project Context

## Design Context

### Users
Developers and users needing test DEMOS tokens for the Demos Network testnet. They arrive with a wallet address ready, wanting to quickly get tokens and continue building/testing. The job to be done is fast, frictionless token acquisition.

### Brand Personality
**Simple, Accessible, Human**

Demos Network prioritizes clarity over complexity. The interface should feel approachable to newcomers while maintaining credibility with experienced blockchain developers. Avoid technical jargon where simple language suffices.

### Aesthetic Direction
- **Visual Tone**: Dark, modern, technical but not intimidating. Glassmorphism with subtle cyan/purple accents.
- **Reference**: The `../minting_app` is the gold standard - same fonts, colors, glass effects, and component patterns.
- **Theme**: Dark mode only. No light mode.
- **Colors to use**: Cyan (#00d4ff), purple (#7c4dff) as accents on deep dark backgrounds (#02060f).
- **Colors to avoid**: Saturated primary colors, anything that feels "playful" or "corporate".

### Design System

#### Typography
```css
/* Display/Headings */
font-family: 'Neue Machina', 'Inter', system-ui, sans-serif;
/* Weights: 300 (Light), 400 (Regular), 800 (Ultrabold) */

/* Body text */
font-family: 'Inter', 'Neue Machina', sans-serif;
/* Variable weight 100-900 */
```

#### Color Tokens
```css
:root {
  /* Backgrounds */
  --background: #02060f;
  --background-secondary: #050a16;
  --glass-surface: rgba(7, 12, 23, 0.8);
  --glass-border: rgba(255, 255, 255, 0.08);
  
  /* Accents */
  --accent-primary: #00d4ff;    /* Cyan */
  --accent-secondary: #7c4dff;  /* Purple */
  
  /* Text */
  --text-primary: #f5f8ff;
  --text-secondary: #a6b4ce;
  --text-muted: #7c88a1;
  
  /* Status */
  --success-green: #19f3a2;
  --warning-yellow: #ffcb57;
  --error-red: #ff4d6d;
  
  /* Radius */
  --radius-lg: 32px;
  --radius-md: 18px;
  --radius-sm: 10px;
}
```

#### Component Patterns (from minting_app)
```css
/* Glass card */
.glass-morphism {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* Primary button */
.btn-primary {
  background: linear-gradient(135deg, #00d4ff, #7c4dff);
  color: #000;
  padding: 1.1rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* Input */
.input {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 1rem 1.1rem;
  color: #f5f8ff;
}
```

### Design Principles

1. **Speed First** - Every interaction should feel instant. Minimize steps, show progress clearly, avoid unnecessary animations that slow perception.

2. **One Action Per Screen** - The faucet has one job: give tokens. Don't distract with secondary features. Form → Button → Result. Done.

3. **Glass, Not Glitz** - Use glassmorphism for depth, but keep it subtle. The blurred logo background adds brand presence without competing for attention.

4. **Status Always Visible** - Users need to know: Is the faucet online? What's the balance? Did my transaction succeed? Show connection status, balances, and transaction results prominently.

5. **Accessible by Default** - WCAG 2.1 AA compliance. Sufficient contrast ratios (cyan on dark works well), focus states on all interactive elements, keyboard navigation support.

### Files to Reference
- `src/styles/main.css` - Current faucet styles (follows the pattern)
- `../minting_app/frontend/src/styles/index.css` - Tailwind + base styles
- `../minting_app/frontend/tailwind.config.js` - Color/token definitions
- `../minting_app/frontend/src/App.tsx` - Layout patterns, component usage
