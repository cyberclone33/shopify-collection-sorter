// LINE Login JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Create global config object for LINE Login if it doesn't exist
  window.lineLoginConfig = window.lineLoginConfig || {};
  
  // Function to get URL parameters
  function getUrlParams() {
    const params = {};
    const searchParams = new URLSearchParams(window.location.search);
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }
    return params;
  }

  // Process LINE login if parameters are present
  function processLineLogin() {
    const params = getUrlParams();
    console.log('LINE Login Parameters:', params);
    
    // Check if this is a LINE login redirect
    if (params.line_login === 'success') {
      const container = document.querySelector('.line-login-form-container');
      const statusElement = document.getElementById('line-login-status');
      const infoElement = document.getElementById('line-login-info');
      
      // Show the container
      if (container) {
        container.style.display = 'block';
      }
      
      // Extract customer information
      const customerId = params.customer_id || params.line_id || '';
      const customerName = params.name ? decodeURIComponent(params.name) : '';
      const customerEmail = params.customer_email ? decodeURIComponent(params.customer_email) : '';
      const accessToken = params.access_token || '';
      const returnUrl = params.return_url || '/account';
      
      // Create customer session using Storefront API
      if (customerEmail && accessToken) {
        // Get the Storefront API token from the config
        const storefrontToken = window.lineLoginConfig?.storefrontApiToken || '';
        
        if (storefrontToken) {
          // Show loading status
          if (statusElement) {
            statusElement.innerHTML = '<p>Authenticating with LINE...</p>';
          }
          
          // Create customer access token using Storefront API
          const graphqlQuery = {
            query: `
              mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
                customerAccessTokenCreate(input: $input) {
                  customerAccessToken {
                    accessToken
                    expiresAt
                  }
                  customerUserErrors {
                    code
                    field
                    message
                  }
                }
              }
            `,
            variables: {
              input: {
                email: customerEmail,
                password: accessToken
              }
            }
          };
          
          fetch('/api/2023-10/graphql.json', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Storefront-Access-Token': storefrontToken
            },
            body: JSON.stringify(graphqlQuery)
          })
          .then(response => response.json())
          .then(data => {
            console.log('Storefront API Response:', data);
            
            if (data.data?.customerAccessTokenCreate?.customerAccessToken?.accessToken) {
              // Success! Show success message
              if (statusElement) {
                statusElement.innerHTML = '<p class="success">Successfully authenticated with LINE!</p>';
              }
              
              // Show user info
              if (infoElement) {
                infoElement.innerHTML = `
                  <p>Welcome, ${customerName}</p>
                  <p>Redirecting to your account...</p>
                `;
              }
              
              // Redirect to account page or specified return URL
              setTimeout(() => {
                window.location.href = returnUrl;
              }, 2000);
            } else {
              // Error in authentication
              const errors = data.data?.customerAccessTokenCreate?.customerUserErrors || [];
              const errorMessage = errors.length > 0 
                ? errors.map(err => err.message).join(', ')
                : 'There was a problem logging in with LINE. Please try again.';
              
              if (statusElement) {
                statusElement.innerHTML = `<p class="error">${errorMessage}</p>`;
              }
              
              // Show manual login option
              if (infoElement) {
                infoElement.innerHTML = `
                  <p>Click the button below to complete your login:</p>
                  <form id="line-manual-login" method="post" action="/account/login">
                    <input type="hidden" name="customer[email]" value="${customerEmail}">
                    <input type="hidden" name="customer[password]" value="${accessToken}">
                    <input type="hidden" name="form_type" value="customer_login">
                    <input type="hidden" name="utf8" value="✓">
                    <input type="hidden" name="return_to" value="${returnUrl}">
                    <button type="submit" class="button">Sign In</button>
                  </form>
                `;
              }
            }
          })
          .catch(error => {
            console.error('Error authenticating with Storefront API:', error);
            
            if (statusElement) {
              statusElement.innerHTML = `<p class="error">There was a problem logging in with LINE. Please try again.</p>`;
            }
          });
        } else {
          // No Storefront API token available
          if (statusElement) {
            statusElement.innerHTML = `<p class="error">Storefront API token is missing. Please contact the store administrator.</p>`;
          }
        }
      } else {
        // Missing required parameters
        if (statusElement) {
          statusElement.innerHTML = `<p class="error">Missing required login information from LINE.</p>`;
        }
      }
    }
  }
  
  // Run when page loads
  processLineLogin();
});
