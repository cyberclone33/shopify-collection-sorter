document.addEventListener('DOMContentLoaded', function() {
  // Check if there's an existing cart drawer on the page from the theme
  const existingCartDrawer = document.querySelector('cart-drawer');
  
  if (existingCartDrawer) {
    // If there's already a cart drawer, use it instead of creating our own
    document.addEventListener('click', function(e) {
      const addToCartButton = e.target.closest('.add-to-cart');
      if (!addToCartButton) return;
      
      e.preventDefault();
      
      const variantId = addToCartButton.getAttribute('data-variant-id');
      if (!variantId) return;
      
      // Set loading state
      addToCartButton.classList.add('is-loading');
      
      // Add to cart using Fetch API
      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', 1);
      
      fetch('/cart/add.js', {
        method: 'POST',
        body: formData
      })
      .then(response => response.json())
      .then(data => {
        // Show success state
        addToCartButton.classList.remove('is-loading');
        addToCartButton.classList.add('is-success');
        
        setTimeout(() => {
          addToCartButton.classList.remove('is-success');
        }, 1000);
        
        // Trigger the theme's cart drawer open event
        document.dispatchEvent(new CustomEvent('dispatch:cart-drawer:open'));
      })
      .catch(error => {
        console.error('Error adding to cart:', error);
        addToCartButton.classList.remove('is-loading');
      });
    });
  }
});
