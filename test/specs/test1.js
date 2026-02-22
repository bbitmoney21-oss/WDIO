// describe('Demo Tests', function () {
//   // it('My First Test', async () => {
//   //   browser.url('https://www.apple.com/ca');

//   //   const searchBox = await $('[name="q"]');
//   //   await searchBox.waitForDisplayed({ timeout: 10000 });

//   //   await searchBox.setValue('WebDriverIO');
//   //   await browser.keys('Enter');

//   //   await browser.pause(2000);
//   // });
//     it('Shop Iphones', async()=>{
//       await browser.url('https://www.apple.com/ca');
      
//       const shopIphone = $('a[aria-label="Shop iphone"]')
//          await  shopIphone.click();
//         shopIphone.waitForDisplayed ({timeout:10000})
//         await shopIphone.click();
//         console.log();
//     });
    
// });

describe('Demo Tests', function() {
  it('Search for products', async () => {
    await browser.url('https://ecommerce-playground.lambdatest.io/');
    await browser.maximizeWindow();
    // await $('//input[@aria-label="Search For Products"]').setValue('iphone')
    // await $('//button[@type="submit"]').click();
    // await browser.pause(3000);

    //Hover over the element
    await $('//span[normalize-space()="Mega Menu"]').moveTo()
    await browser.pause(3000);
    await $('a[title="Printer"]').click();
  const title = await $('h1')
  await title.waitUntil(async function () {
    return await this.getText() === 'Printers'
  }, {
    timeout: 3000,
    timeoutMsg: 'Expected page title to be Printers'

  });
  const checkbox = await $('(//label[normalize-space()="Pre-Order"])[2]');
    await checkbox.click();
    await browser.waitUntil(async function () {
      const elementCount = await $$('.product-thumb').length
      return await elementCount === 2;
      
    }, {
      timeout: 5000,
      timeoutMsg: 'Expected 2 items but found different number',
      interval:1000
    });
    await browser.pause(2000);
  });
});