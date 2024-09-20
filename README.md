# Octopus

## Prereqs
- npm, axios
- Octopus energy account and Account Number
- Octpus API Key

Uses the octopus API to download and link your data together to output costs
Things to note:
- Consumption for electric and gas is rounded to 2dpb before converting to price on octopus' end
- Gas with a SMETS1 and 2 differ - some get kWh some get m3
- Need to convert gas to kWh before you can get an accurate cost
- Within `tariff.json` you need to add in your product code for gas and electric. 

- Within `/tests` you can find individual working snippets to use all the octopus public endpoints. `test_get_all_cli.js` asks for a YYYY-MM-DD and HH:MM:SS start-date and end-date, and downloads the usage and tairffs for this period


## Setup
- Create `config.json` with the following:
```json
{
  "account_num": "your_account_number",
  "api_key": "your_api_key"
}
```
- Run `tests/test_account.js`
- This will provide instructions as to what to do next, but essentially you need three pieces of information;
- - Gas Conversion Factor - can be found on gas bill, or by comparing gas consumption on the API vs the csv that you can download from octopus. If unsure and want to check this later, typical value is about 11.22063333 as of SEP-24
- - Electric Product Code and Gas Product Code

### Product Codes
- These are not the same as the tariff, for example Octopus Intelligent GO has lots of different tariffs within it, some are no longer available. You need to match your tariff to the product code:
- The tariff codes are a subset of the product codes. To do this, run `test_all_products.js`. This will generate `all_tariffs.json`
-  Within all_tariffs.json, look through and find a global electric product that might include your specific tariff, for example E-1R-INTELLI-VAR-22-10-14-M matches GO-VAR-22-10-14 - (This is somewhat trial and error)
- Find a matching Gas and Electric product code in this json file and put their values into `tariff.json` in the matching variables
- Then run test_product.js which will take the gas and electric product codes, and output the SPECIFIC tariffs within each product to `TEST_ELECTRIC/GAS_TARIFF.json`
- You can then perform a manual check that the tariff exists within the product by looking through this file and seeing whether there is a product that matches, if it does, you can simply leave those values in tariff.json unchanged. If they don't match, simply choose another product code and look for it again.
- `test_match_tariff.js` will attempt to automate this, but is contingent on using only direct debit easy tariffs and will simply output a SUCCESS or ERROR for each tariff. 

- Once you have updated these three values, you are ready to go. 