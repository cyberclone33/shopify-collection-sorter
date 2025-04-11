# Dizzy Dizzo Theme Block

A versatile Shopify theme block system that allows you to embed Dizzy Dizzo components throughout your Shopify theme using the theme editor.

## Features

- **Universal Embedding**: Add Dizzy Dizzo components to any section in your theme that supports blocks
- **Multiple Display Modes**: Choose from Featured Products, Custom Content, or Promotional Banner modes
- **Flexible Configuration**: Customize colors, sizes, spacing, and content directly from the theme editor
- **Responsive Design**: Automatically adapts to different screen sizes
- **Interactive Elements**: Add to cart functionality, countdown timers, and more

## Installation Guide

### Method 1: Adding to an Existing Theme

1. **Upload files to your theme**:
   - Go to your Shopify admin > **Online Store** > **Themes**
   - Click on **Actions** > **Edit code** for your current theme
   - Create the following directories if they don't exist:
     - `sections/blocks`
     - `sections/snippets`
   - Upload the following files to their respective locations:
     - `dizzy-dizzo-section.css` to `assets/`
     - `dizzy-dizzo-embed.liquid` to `sections/blocks/`
     - `dizzy-dizzo-register.liquid` to `sections/`
     - `dizzy-dizzo-init.liquid` to `snippets/`

2. **Add the initialization snippet to your theme**:
   - Open `layout/theme.liquid`
   - Add `{% render 'dizzy-dizzo-init' %}` just before the closing `</head>` tag

3. **Using the theme block**:
   - Go to your theme customizer
   - Select any section that supports blocks
   - Click "Add block"
   - Look for "Dizzy Dizzo Embed" in the block options

### Method 2: Using as a Section

If you prefer to use Dizzy Dizzo as a standalone section:

1. Upload all files as directed in Method 1
2. When customizing your theme, look for "Add section" > "Custom" > "Dizzy Dizzo Embed"

## Customization Options

### Display Modes

- **Featured Products**: Showcase products from a selected collection
- **Custom Content**: Display custom text, images, and buttons
- **Promotional Banner**: Create eye-catching promotional banners with optional countdown timers

### Visual Customization

- Background color
- Text color
- Accent color
- Padding and spacing
- Border radius
- Text alignment
- Title and subtitle font sizes

### Product Display Options

- Number of products to display
- Products per row
- Sale badges and discount percentages
- Add to cart buttons
- View all button

## Support

For questions or issues, please contact our support team or refer to the documentation.

## License

This code is provided for use with Shopify themes as part of the Dizzy Dizzo application.
