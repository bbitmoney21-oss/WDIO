const LoginPage = require('../pageobjects/login.page');

describe('Demo Tests', function(){

    it('Login Test', async()=>{
        await browser.url('https://sauce-demo.myshopify.com/');
        await browser.maximizeWindow();
        
        const loginLink = await $('//a[@id="customer_login_link"]');
        await loginLink.click();
        await LoginPage.login('venkatesh','password123');
        await LoginPage.clickLoginButton().click();
        await LoginPage.checkLoginSuccess('Your Orders');
    })
 
});
 