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


## Rounding
- Octopus state: 
"Electricity consumption data is returned to the nearest 0.001kwh. For billing, consumption is rounded to the nearest 0.01kwh before multiplying by the price. The rounding method used is rounding half to even, where numbers ending in 5 are rounded up or down, towards the nearest even hundredth decimal place. As a result, 0.015 would be rounded up to 0.02, while 0.025 is rounded down to 0.02."
- However this doesn't seem to quite match up exactly to the "Estimated price" column on the octopus data

- The best approximation I can make to the "Estimated Cost" column from the Octopus CSV data is to round to 2 degrees of precision and then approximate costs. Remember that Octopus use EXCLUDING VAT on their data set csv not including VAT to change the commented line in `test_process_price.js` if comparing.

- This method approximates to within 1% on average of 1 penny in cost, so that's probably as good as one can acquire 


## Usage
### Iterative and Programmatic Insertion
- Within `./lib` you can find `invokeDataProcessor.js` which starts at 2024-09-01 and increases by one day with each press of enter, inserting these into the postgres database. 
- This function calls `octopusDataProcessor` which is a conjugate of a variety of other features that uses all the codebase. 
- It defines a start date/time and end date/time before querying Octopus directly calling `getOctopusData()` to get the raw data. The raw data is then processed by `processPrices` which is the function that calculates rounding, and costs  based on unit rates for that date/time (`getOctopusData` also collects tariff data). Finally it inserts those bits of data using `gasInsert`, `electricInsert`, and `standingChargeInsert` functions. 
- Also within that folder is `testGOD.js` which is a 'single' use function to to breakdown the above functions into their constituent parts. 

### Manual Tests
- The `./tests` folder contains piecemeal step by step instructions on getting data from octopus
- These ultimately culminate, from a data-acquisition point of view in either `test_get_all_cli.js` which asks for date/times for start and stop, and then loads the data, before saving it into a json file in `./reports/report_datetime.json`, OR in `test_get_all_data_period.js` which loads data for start_period and end_period on lines 26/27 and then runs the query but this just OUTPUTS the data to the console, it doesn't save it. 

## Postgres
- Within `./pg` exists a series of sample functions for inserting into the postgres database. See `DATABASE_SETUP.md` for how to setup the database correctly. 
- `test_insert_gas.js` and `test_insert_electric.js` show the logic and sample queries for inserting gas and electric usage data, but note these functions expect PROCESSED data, that is they need to have a `price_pence` attribute in their object
- `test_insert_g_sc.js` should now be a mirror of `test_insert_e_sc.js` as their logic was changed to insert standing charges at the same time. 
- The `view_..` functions simply print out the tables for the relevant usages and standing charges

## Servers
### Web Server
- Runs on port `http://localhost:52529/` with, currently, endpoints `/view_electric` and `/view_gas` generating a nice little bootstrap table. It includes an option to download as a CSV which makes it easier to compare with Octopus's output data.

### Socket Listener
- This is a function for listening to events from Home Assistant.
- You need to set `./server/server_config.json` with:
```
{
  "ha_ip": "192.168.xx.yy",
  "token": "LongLivedTokenFromHomeAssistant"
}
```
- When calling `socket_listener.js` it will then listen for, and populate the relevant data to the audi event tables in postgres. 