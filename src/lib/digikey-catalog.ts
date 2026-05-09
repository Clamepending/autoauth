export type DigiKeyPriceBreak = {
  quantity: number;
  unitPriceMicros: number;
  unitPriceDisplay: string;
};

export type DigiKeyCatalogItem = {
  manufacturerPartNumber: string;
  digiKeyPartNumber: string;
  title: string;
  description: string;
  manufacturer: string;
  url: string;
  packaging: string;
  stockStatus: "in_stock" | "limited" | "unknown";
  sourcePriceDisplay: string;
  verifiedAt: string;
  priceBreaks: DigiKeyPriceBreak[];
  tags: string[];
  searchTerms: string[];
};

export type PricedDigiKeyCatalogItem = {
  item: DigiKeyCatalogItem;
  requestedQuantity: number;
  selectedBreak: DigiKeyPriceBreak;
  sourceTotalCents: number;
  totalCents: number;
};

export const DIGIKEY_SAFETY_MARGIN_BPS = 500;
export const DIGIKEY_CATALOG_VERIFIED_AT = "2026-05-09";

function usdMicros(value: string) {
  return Math.round(Number(value) * 1_000_000);
}

// Visible DigiKey prices/stock snapshots were checked from rendered DigiKey
// product pages and official product/category pages on 2026-05-09. Quote
// helpers apply the 5% safety margin at runtime and still revalidate checkout.
export const DIGIKEY_CATALOG: DigiKeyCatalogItem[] = [
  {
    manufacturerPartNumber: "LM358P",
    digiKeyPartNumber: "296-1395-5-ND",
    title: "LM358P dual general-purpose op amp",
    description: "Texas Instruments dual op amp in 8-PDIP, common breadboard/prototype part.",
    manufacturer: "Texas Instruments",
    url: "https://www.digikey.com/en/products/detail/texas-instruments/LM358P/277042",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.27000, 10: $0.18700, 100: $0.14230",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.27000"), unitPriceDisplay: "$0.27000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.18700"), unitPriceDisplay: "$0.18700" },
      { quantity: 50, unitPriceMicros: usdMicros("0.15300"), unitPriceDisplay: "$0.15300" },
      { quantity: 100, unitPriceMicros: usdMicros("0.14230"), unitPriceDisplay: "$0.14230" },
    ],
    tags: ["op amp", "analog", "through hole", "dip", "prototype"],
    searchTerms: ["lm358", "lm358p", "lm358n", "dual op amp", "operational amplifier", "8 dip"],
  },
  {
    manufacturerPartNumber: "NE555P",
    digiKeyPartNumber: "296-NE555P-ND",
    title: "NE555P 555 timer IC",
    description: "Texas Instruments single 555 timer/oscillator in 8-PDIP.",
    manufacturer: "Texas Instruments",
    url: "https://www.digikey.com/en/products/detail/texas-instruments/NE555P/277057",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.51000, 10: $0.35800, 100: $0.27830",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.51000"), unitPriceDisplay: "$0.51000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.35800"), unitPriceDisplay: "$0.35800" },
      { quantity: 50, unitPriceMicros: usdMicros("0.29720"), unitPriceDisplay: "$0.29720" },
      { quantity: 100, unitPriceMicros: usdMicros("0.27830"), unitPriceDisplay: "$0.27830" },
    ],
    tags: ["timer", "oscillator", "through hole", "dip", "prototype"],
    searchTerms: ["ne555", "ne555p", "555", "555 timer", "timer ic", "oscillator"],
  },
  {
    manufacturerPartNumber: "ATMEGA328P-PU",
    digiKeyPartNumber: "ATMEGA328P-PU-ND",
    title: "ATmega328P-PU 8-bit AVR microcontroller",
    description: "Microchip 32 KB AVR MCU in 28-PDIP, common Arduino-compatible controller.",
    manufacturer: "Microchip Technology",
    url: "https://www.digikey.com/en/products/detail/microchip-technology/ATMEGA328P-PU/1914589",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $2.89000, 25: $2.65000, 100: $2.39000",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("2.89000"), unitPriceDisplay: "$2.89000" },
      { quantity: 25, unitPriceMicros: usdMicros("2.65000"), unitPriceDisplay: "$2.65000" },
      { quantity: 100, unitPriceMicros: usdMicros("2.39000"), unitPriceDisplay: "$2.39000" },
    ],
    tags: ["microcontroller", "avr", "arduino", "through hole", "dip"],
    searchTerms: ["atmega328", "atmega328p", "atmega328p pu", "arduino chip", "avr mcu"],
  },
  {
    manufacturerPartNumber: "ATTINY85-20PU",
    digiKeyPartNumber: "ATTINY85-20PU-ND",
    title: "ATtiny85-20PU 8-bit AVR microcontroller",
    description: "Microchip 8 KB AVR MCU in 8-PDIP for small embedded prototypes.",
    manufacturer: "Microchip Technology",
    url: "https://www.digikey.com/en/products/detail/microchip-technology/ATTINY85-20PU/735469",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $1.66000, 25: $1.52000, 100: $1.39000",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("1.66000"), unitPriceDisplay: "$1.66000" },
      { quantity: 25, unitPriceMicros: usdMicros("1.52000"), unitPriceDisplay: "$1.52000" },
      { quantity: 100, unitPriceMicros: usdMicros("1.39000"), unitPriceDisplay: "$1.39000" },
    ],
    tags: ["microcontroller", "avr", "through hole", "dip", "prototype"],
    searchTerms: ["attiny85", "attiny85 20pu", "tiny85", "8 pin microcontroller"],
  },
  {
    manufacturerPartNumber: "ESP32-WROOM-32E-N4",
    digiKeyPartNumber: "1965-ESP32-WROOM-32E-N4CT-ND",
    title: "ESP32-WROOM-32E-N4 Wi-Fi/Bluetooth module",
    description: "Espressif ESP32 wireless module, 4 MB flash, castellated SMD module.",
    manufacturer: "Espressif Systems",
    url: "https://www.digikey.com/en/products/detail/espressif-systems/ESP32-WROOM-32E-N4/11613125",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $4.99000, 10: $4.31400, 100: $3.75850",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("4.99000"), unitPriceDisplay: "$4.99000" },
      { quantity: 10, unitPriceMicros: usdMicros("4.31400"), unitPriceDisplay: "$4.31400" },
      { quantity: 25, unitPriceMicros: usdMicros("4.08000"), unitPriceDisplay: "$4.08000" },
      { quantity: 100, unitPriceMicros: usdMicros("3.75850"), unitPriceDisplay: "$3.75850" },
    ],
    tags: ["wireless", "wifi", "bluetooth", "module", "esp32"],
    searchTerms: ["esp32", "esp32 wroom", "esp32 wroom 32e", "wifi module", "bluetooth module"],
  },
  {
    manufacturerPartNumber: "A000066",
    digiKeyPartNumber: "1050-1024-ND",
    title: "Arduino Uno R3 board",
    description: "Official Arduino Uno R3 ATmega328P development board.",
    manufacturer: "Arduino",
    url: "https://www.digikey.com/en/products/detail/arduino/A000066/2784006",
    packaging: "Box",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $27.60000, 10: $27.05000, 100: $24.70010",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("27.60000"), unitPriceDisplay: "$27.60000" },
      { quantity: 10, unitPriceMicros: usdMicros("27.05000"), unitPriceDisplay: "$27.05000" },
      { quantity: 25, unitPriceMicros: usdMicros("26.58000"), unitPriceDisplay: "$26.58000" },
      { quantity: 100, unitPriceMicros: usdMicros("24.70010"), unitPriceDisplay: "$24.70010" },
    ],
    tags: ["development board", "arduino", "prototype", "microcontroller"],
    searchTerms: ["arduino", "arduino uno", "uno r3", "a000066", "atmega328p board"],
  },
  {
    manufacturerPartNumber: "2N3904BU",
    digiKeyPartNumber: "2N3904FS-ND",
    title: "2N3904BU NPN transistor",
    description: "onsemi 2N3904 general-purpose NPN BJT, TO-92 through-hole package.",
    manufacturer: "onsemi",
    url: "https://www.digikey.com/en/products/detail/onsemi/2N3904BU/1413",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.28000, 10: $0.16800, 100: $0.10500",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.28000"), unitPriceDisplay: "$0.28000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.16800"), unitPriceDisplay: "$0.16800" },
      { quantity: 100, unitPriceMicros: usdMicros("0.10500"), unitPriceDisplay: "$0.10500" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.06828"), unitPriceDisplay: "$0.06828" },
    ],
    tags: ["transistor", "npn", "through hole", "bjt", "prototype"],
    searchTerms: ["2n3904", "2n3904bu", "npn transistor", "to 92 transistor"],
  },
  {
    manufacturerPartNumber: "2N3906",
    digiKeyPartNumber: "4878-2N3906CT-ND",
    title: "2N3906 PNP transistor",
    description: "Diotec 2N3906 general-purpose PNP BJT, TO-92 through-hole package.",
    manufacturer: "Diotec Semiconductor",
    url: "https://www.digikey.com/en/products/detail/diotec-semiconductor/2N3906/22191309",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.14000, 10: $0.08800, 100: $0.05430",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.14000"), unitPriceDisplay: "$0.14000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.08800"), unitPriceDisplay: "$0.08800" },
      { quantity: 100, unitPriceMicros: usdMicros("0.05430"), unitPriceDisplay: "$0.05430" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.03434"), unitPriceDisplay: "$0.03434" },
    ],
    tags: ["transistor", "pnp", "through hole", "bjt", "prototype"],
    searchTerms: ["2n3906", "pnp transistor", "to 92 transistor"],
  },
  {
    manufacturerPartNumber: "1N4148W-TP",
    digiKeyPartNumber: "1N4148W-TPMSCT-ND",
    title: "1N4148W-TP switching diode",
    description: "MCC 100 V small-signal switching diode, SOD-123 surface-mount package.",
    manufacturer: "MCC (Micro Commercial Components)",
    url: "https://www.digikey.com/en/products/filter/diodes/rectifiers/single-diodes/280",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.10000, 3000: $0.02636",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.10000"), unitPriceDisplay: "$0.10000" },
      { quantity: 3000, unitPriceMicros: usdMicros("0.02636"), unitPriceDisplay: "$0.02636" },
    ],
    tags: ["diode", "switching diode", "smd", "sod123"],
    searchTerms: ["1n4148", "1n4148w", "switching diode", "signal diode"],
  },
  {
    manufacturerPartNumber: "1N4007-TP",
    digiKeyPartNumber: "1N4007-TPMSCT-ND",
    title: "1N4007-TP rectifier diode",
    description: "MCC 1000 V 1 A through-hole rectifier diode, DO-41 package.",
    manufacturer: "MCC (Micro Commercial Components)",
    url: "https://www.digikey.com/en/products/detail/mcc-micro-commercial-components/1N4007-TP/773644",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.11000, 10: $0.08000, 100: $0.07300",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.11000"), unitPriceDisplay: "$0.11000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.08000"), unitPriceDisplay: "$0.08000" },
      { quantity: 100, unitPriceMicros: usdMicros("0.07300"), unitPriceDisplay: "$0.07300" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.04598"), unitPriceDisplay: "$0.04598" },
    ],
    tags: ["diode", "rectifier", "through hole", "do41"],
    searchTerms: ["1n4007", "1n4007 tp", "rectifier diode", "power diode"],
  },
  {
    manufacturerPartNumber: "IRLZ44NPBF",
    digiKeyPartNumber: "IRLZ44NPBF-ND",
    title: "IRLZ44NPBF logic-level N-channel MOSFET",
    description: "Infineon 55 V 47 A through-hole TO-220 logic-level MOSFET.",
    manufacturer: "Infineon Technologies",
    url: "https://www.digikey.com/en/products/detail/infineon-technologies/IRLZ44NPBF/811808",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $1.96000, 50: $0.93920, 100: $0.83940",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("1.96000"), unitPriceDisplay: "$1.96000" },
      { quantity: 50, unitPriceMicros: usdMicros("0.93920"), unitPriceDisplay: "$0.93920" },
      { quantity: 100, unitPriceMicros: usdMicros("0.83940"), unitPriceDisplay: "$0.83940" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.60765"), unitPriceDisplay: "$0.60765" },
    ],
    tags: ["mosfet", "n channel", "logic level", "through hole", "to220"],
    searchTerms: ["irlz44n", "irlz44npbf", "logic level mosfet", "n channel mosfet", "to 220 mosfet"],
  },
  {
    manufacturerPartNumber: "L7805CV",
    digiKeyPartNumber: "497-1443-5-ND",
    title: "L7805CV 5 V linear regulator",
    description: "STMicroelectronics 5 V 1.5 A positive linear regulator, TO-220 package.",
    manufacturer: "STMicroelectronics",
    url: "https://www.digikey.com/en/products/detail/stmicroelectronics/L7805CV/585964",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.56000, 10: $0.39500, 100: $0.30810",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.56000"), unitPriceDisplay: "$0.56000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.39500"), unitPriceDisplay: "$0.39500" },
      { quantity: 100, unitPriceMicros: usdMicros("0.30810"), unitPriceDisplay: "$0.30810" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.26241"), unitPriceDisplay: "$0.26241" },
    ],
    tags: ["regulator", "linear regulator", "5v", "through hole", "to220"],
    searchTerms: ["7805", "l7805", "l7805cv", "5v regulator", "linear voltage regulator"],
  },
  {
    manufacturerPartNumber: "RC0603FR-0710KL",
    digiKeyPartNumber: "311-10.0KHRCT-ND",
    title: "10 kOhm 1% 0603 resistor",
    description: "YAGEO RC_L 10 kOhm 1% 1/10 W 0603 thick-film chip resistor.",
    manufacturer: "YAGEO",
    url: "https://www.digikey.com/en/products/filter/chip-resistor-surface-mount/0603/52",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.10000, 5000: $0.00400",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.10000"), unitPriceDisplay: "$0.10000" },
      { quantity: 5000, unitPriceMicros: usdMicros("0.00400"), unitPriceDisplay: "$0.00400" },
    ],
    tags: ["resistor", "10k", "0603", "smd", "passive"],
    searchTerms: ["10k resistor", "10 kohm resistor", "0603 resistor", "rc0603fr 0710kl", "smd resistor"],
  },
  {
    manufacturerPartNumber: "RC0805FR-0710KL",
    digiKeyPartNumber: "311-10.0KCRCT-ND",
    title: "10 kOhm 1% 0805 resistor",
    description: "YAGEO RC_L 10 kOhm 1% 1/8 W 0805 thick-film chip resistor.",
    manufacturer: "YAGEO",
    url: "https://www.digikey.com/en/products/detail/yageo/RC0805FR-0710KL/727535",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.10000, 100: $0.01560, 1000: $0.00879",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.10000"), unitPriceDisplay: "$0.10000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.03200"), unitPriceDisplay: "$0.03200" },
      { quantity: 100, unitPriceMicros: usdMicros("0.01560"), unitPriceDisplay: "$0.01560" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.00879"), unitPriceDisplay: "$0.00879" },
      { quantity: 5000, unitPriceMicros: usdMicros("0.00604"), unitPriceDisplay: "$0.00604" },
    ],
    tags: ["resistor", "10k", "0805", "smd", "passive"],
    searchTerms: ["10k resistor", "10 kohm resistor", "0805 resistor", "rc0805fr 0710kl", "smd resistor"],
  },
  {
    manufacturerPartNumber: "CL10B104KB8WPNC",
    digiKeyPartNumber: "1276-6854-1-ND",
    title: "0.1 uF 50 V X7R 0603 ceramic capacitor",
    description: "Samsung 0.1 uF 50 V X7R 0603 MLCC for decoupling/bypass use.",
    manufacturer: "Samsung Electro-Mechanics",
    url: "https://www.digikey.com/en/products/detail/samsung-electro-mechanics/CL10B104KB8WPNC/5961338",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.10000, 100: $0.02520, 1000: $0.01611",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.10000"), unitPriceDisplay: "$0.10000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.04300"), unitPriceDisplay: "$0.04300" },
      { quantity: 100, unitPriceMicros: usdMicros("0.02520"), unitPriceDisplay: "$0.02520" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.01611"), unitPriceDisplay: "$0.01611" },
      { quantity: 4000, unitPriceMicros: usdMicros("0.00988"), unitPriceDisplay: "$0.00988" },
    ],
    tags: ["capacitor", "0.1uf", "100nf", "0603", "smd", "decoupling"],
    searchTerms: ["0.1uf capacitor", "100nf capacitor", "0603 capacitor", "decoupling capacitor", "cl10b104"],
  },
  {
    manufacturerPartNumber: "GRM188R72A104KA35D",
    digiKeyPartNumber: "490-3285-1-ND",
    title: "0.1 uF 100 V X7R 0603 ceramic capacitor",
    description: "Murata 0.1 uF 100 V X7R 0603 MLCC for higher-voltage decoupling.",
    manufacturer: "Murata Electronics",
    url: "https://www.digikey.com/en/products/detail/murata-electronics/GRM188R72A104KA35D/702549",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.15000, 100: $0.05080, 1000: $0.03406",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.15000"), unitPriceDisplay: "$0.15000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.08300"), unitPriceDisplay: "$0.08300" },
      { quantity: 100, unitPriceMicros: usdMicros("0.05080"), unitPriceDisplay: "$0.05080" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.03406"), unitPriceDisplay: "$0.03406" },
    ],
    tags: ["capacitor", "0.1uf", "100nf", "0603", "smd", "decoupling"],
    searchTerms: ["0.1uf 100v capacitor", "100nf 100v capacitor", "0603 capacitor", "grm188"],
  },
  {
    manufacturerPartNumber: "ECE-A1CKA100",
    digiKeyPartNumber: "P807-ND",
    title: "10 uF 16 V radial electrolytic capacitor",
    description: "Panasonic 10 uF 16 V aluminum electrolytic capacitor for breadboards and through-hole prototypes.",
    manufacturer: "Panasonic Industry",
    url: "https://www.digikey.com/en/products/detail/panasonic-electronic-components/ECE-A1CKA100/6914",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.26000, 10: $0.15500, 200: $0.08735",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.26000"), unitPriceDisplay: "$0.26000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.15500"), unitPriceDisplay: "$0.15500" },
      { quantity: 50, unitPriceMicros: usdMicros("0.11240"), unitPriceDisplay: "$0.11240" },
      { quantity: 200, unitPriceMicros: usdMicros("0.08735"), unitPriceDisplay: "$0.08735" },
    ],
    tags: ["capacitor", "10uf", "electrolytic", "through hole", "passive"],
    searchTerms: ["10uf capacitor", "electrolytic capacitor", "radial capacitor", "ece a1cka100"],
  },
  {
    manufacturerPartNumber: "LTST-C190KRKT",
    digiKeyPartNumber: "160-1436-1-ND",
    title: "Red 0603 indicator LED",
    description: "Lite-On red 631 nm 0603 surface-mount LED.",
    manufacturer: "Lite-On Inc.",
    url: "https://www.digikey.com/en/products/detail/liteon/LTST-C190KRKT/386817",
    packaging: "Cut Tape",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.14000, 100: $0.06740, 1000: $0.04869",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.14000"), unitPriceDisplay: "$0.14000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.09800"), unitPriceDisplay: "$0.09800" },
      { quantity: 100, unitPriceMicros: usdMicros("0.06740"), unitPriceDisplay: "$0.06740" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.04869"), unitPriceDisplay: "$0.04869" },
    ],
    tags: ["led", "red", "0603", "smd", "indicator"],
    searchTerms: ["red led", "0603 led", "indicator led", "ltst c190"],
  },
  {
    manufacturerPartNumber: "B3F-1000",
    digiKeyPartNumber: "SW400-ND",
    title: "B3F-1000 tactile pushbutton switch",
    description: "Omron through-hole SPST-NO 6 mm tactile switch, top actuated.",
    manufacturer: "Omron Electronics Inc-EMC Div",
    url: "https://www.digikey.com/en/products/detail/omron-electronics-inc-emc-div/B3F-1000/33150",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.35000, 10: $0.29900, 100: $0.25060",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.35000"), unitPriceDisplay: "$0.35000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.29900"), unitPriceDisplay: "$0.29900" },
      { quantity: 100, unitPriceMicros: usdMicros("0.25060"), unitPriceDisplay: "$0.25060" },
      { quantity: 500, unitPriceMicros: usdMicros("0.21916"), unitPriceDisplay: "$0.21916" },
    ],
    tags: ["switch", "button", "tactile", "through hole", "prototype"],
    searchTerms: ["tactile switch", "push button", "pushbutton", "b3f 1000", "6mm switch"],
  },
  {
    manufacturerPartNumber: "B2B-PH-K-S",
    digiKeyPartNumber: "455-1704-ND",
    title: "JST PH 2-pin vertical header",
    description: "JST PH series 2-position 2 mm through-hole shrouded board header.",
    manufacturer: "JST Sales America Inc.",
    url: "https://www.digikey.com/en/products/detail/jst-sales-america-inc/B2B-PH-K-S/926611",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.11000, 10: $0.09800, 100: $0.08290",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.11000"), unitPriceDisplay: "$0.11000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.09800"), unitPriceDisplay: "$0.09800" },
      { quantity: 100, unitPriceMicros: usdMicros("0.08290"), unitPriceDisplay: "$0.08290" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.07043"), unitPriceDisplay: "$0.07043" },
    ],
    tags: ["connector", "jst", "ph", "2 pin", "through hole"],
    searchTerms: ["jst ph", "jst ph 2 pin", "battery connector", "b2b ph", "2mm header"],
  },
  {
    manufacturerPartNumber: "3-644456-6",
    digiKeyPartNumber: "A31116-ND",
    title: "6-pin 2.54 mm vertical header",
    description: "TE Connectivity MTA-100 6-position 0.100 inch through-hole header.",
    manufacturer: "TE Connectivity AMP Connectors",
    url: "https://www.digikey.com/en/products/detail/te-connectivity-amp-connectors/3-644456-6/698348",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $0.43000, 10: $0.36400, 100: $0.30930",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("0.43000"), unitPriceDisplay: "$0.43000" },
      { quantity: 10, unitPriceMicros: usdMicros("0.36400"), unitPriceDisplay: "$0.36400" },
      { quantity: 100, unitPriceMicros: usdMicros("0.30930"), unitPriceDisplay: "$0.30930" },
      { quantity: 1000, unitPriceMicros: usdMicros("0.26285"), unitPriceDisplay: "$0.26285" },
    ],
    tags: ["connector", "header", "2.54mm", "through hole", "prototype"],
    searchTerms: ["pin header", "2.54mm header", "6 pin header", "0.1 inch header", "3 644456 6"],
  },
  {
    manufacturerPartNumber: "MCP23017-E/SP",
    digiKeyPartNumber: "MCP23017-E/SP-ND",
    title: "MCP23017 16-bit I2C I/O expander",
    description: "Microchip MCP23017 16-bit I2C GPIO expander in 28-SPDIP package.",
    manufacturer: "Microchip Technology",
    url: "https://www.digikey.com/en/products/detail/microchip-technology/MCP23017-E-SP/894272",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $1.69000, 25: $1.40000, 100: $1.28000",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("1.69000"), unitPriceDisplay: "$1.69000" },
      { quantity: 25, unitPriceMicros: usdMicros("1.40000"), unitPriceDisplay: "$1.40000" },
      { quantity: 100, unitPriceMicros: usdMicros("1.28000"), unitPriceDisplay: "$1.28000" },
    ],
    tags: ["io expander", "i2c", "gpio", "through hole", "dip"],
    searchTerms: ["mcp23017", "mcp23017 e sp", "i2c expander", "gpio expander", "io expander"],
  },
  {
    manufacturerPartNumber: "PCA9685PW/Q900,118",
    digiKeyPartNumber: "568-5931-1-ND",
    title: "PCA9685 16-channel PWM driver",
    description: "NXP 16-output I2C PWM LED/servo driver in 28-TSSOP package.",
    manufacturer: "NXP USA Inc.",
    url: "https://www.digikey.com/en/products/detail/nxp-usa-inc/PCA9685PW-Q900-118/2406198",
    packaging: "Cut Tape",
    stockStatus: "limited",
    sourcePriceDisplay: "1: $3.56000, 10: $2.67900, 100: $2.21420",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("3.56000"), unitPriceDisplay: "$3.56000" },
      { quantity: 10, unitPriceMicros: usdMicros("2.67900"), unitPriceDisplay: "$2.67900" },
      { quantity: 25, unitPriceMicros: usdMicros("2.45760"), unitPriceDisplay: "$2.45760" },
      { quantity: 100, unitPriceMicros: usdMicros("2.21420"), unitPriceDisplay: "$2.21420" },
    ],
    tags: ["pwm", "servo", "led driver", "i2c", "smd"],
    searchTerms: ["pca9685", "servo driver", "pwm driver", "16 channel pwm", "led driver"],
  },
  {
    manufacturerPartNumber: "DS18B20+PAR",
    digiKeyPartNumber: "DS18B20+PAR-ND",
    title: "DS18B20+PAR 1-Wire temperature sensor",
    description: "Analog Devices/Maxim DS18B20 digital temperature sensor in TO-92 package.",
    manufacturer: "Analog Devices Inc./Maxim Integrated",
    url: "https://www.digikey.com/en/products/detail/analog-devices-inc-maxim-integrated/DS18B20-PAR/1197285",
    packaging: "Bulk",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $8.24000, 10: $7.13900, 100: $6.31680",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("8.24000"), unitPriceDisplay: "$8.24000" },
      { quantity: 5, unitPriceMicros: usdMicros("7.43600"), unitPriceDisplay: "$7.43600" },
      { quantity: 10, unitPriceMicros: usdMicros("7.13900"), unitPriceDisplay: "$7.13900" },
      { quantity: 100, unitPriceMicros: usdMicros("6.31680"), unitPriceDisplay: "$6.31680" },
    ],
    tags: ["sensor", "temperature", "1-wire", "through hole", "to92"],
    searchTerms: ["ds18b20", "ds18b20 par", "temperature sensor", "1 wire sensor"],
  },
  {
    manufacturerPartNumber: "ULN2803A",
    digiKeyPartNumber: "497-2356-5-ND",
    title: "ULN2803A 8-channel Darlington driver",
    description: "STMicroelectronics 8 NPN Darlington transistor array in 18-DIP package.",
    manufacturer: "STMicroelectronics",
    url: "https://www.digikey.com/en/products/detail/stmicroelectronics/ULN2803A/599591",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $2.14000, 20: $1.47400, 100: $1.28990",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("2.14000"), unitPriceDisplay: "$2.14000" },
      { quantity: 20, unitPriceMicros: usdMicros("1.47400"), unitPriceDisplay: "$1.47400" },
      { quantity: 100, unitPriceMicros: usdMicros("1.28990"), unitPriceDisplay: "$1.28990" },
      { quantity: 500, unitPriceMicros: usdMicros("1.17260"), unitPriceDisplay: "$1.17260" },
    ],
    tags: ["driver", "darlington", "relay", "motor", "through hole", "dip"],
    searchTerms: ["uln2803", "uln2803a", "darlington array", "relay driver", "motor driver"],
  },
  {
    manufacturerPartNumber: "SN74HC595N",
    digiKeyPartNumber: "296-1600-5-ND",
    title: "SN74HC595N 8-bit shift register",
    description: "Texas Instruments 8-bit serial-in/parallel-out shift register in 16-PDIP.",
    manufacturer: "Texas Instruments",
    url: "https://www.digikey.com/en/products/detail/texas-instruments/SN74HC595N/277246",
    packaging: "Tube",
    stockStatus: "in_stock",
    sourcePriceDisplay: "1: $1.64000",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("1.64000"), unitPriceDisplay: "$1.64000" },
    ],
    tags: ["logic", "shift register", "through hole", "dip", "prototype"],
    searchTerms: ["74hc595", "sn74hc595", "sn74hc595n", "shift register", "serial to parallel"],
  },
  {
    manufacturerPartNumber: "MAX7219CNG+",
    digiKeyPartNumber: "MAX7219CNG+-ND",
    title: "MAX7219CNG+ 8-digit LED display driver",
    description: "Analog Devices/Maxim LED display driver for 7-segment displays, 24-PDIP.",
    manufacturer: "Analog Devices Inc./Maxim Integrated",
    url: "https://www.digikey.com/en/products/detail/analog-devices-inc-maxim-integrated/MAX7219CNG/948191",
    packaging: "Tube",
    stockStatus: "limited",
    sourcePriceDisplay: "1: $16.29000, 15: $12.51333, 105: $11.11724",
    verifiedAt: DIGIKEY_CATALOG_VERIFIED_AT,
    priceBreaks: [
      { quantity: 1, unitPriceMicros: usdMicros("16.29000"), unitPriceDisplay: "$16.29000" },
      { quantity: 15, unitPriceMicros: usdMicros("12.51333"), unitPriceDisplay: "$12.51333" },
      { quantity: 105, unitPriceMicros: usdMicros("11.11724"), unitPriceDisplay: "$11.11724" },
    ],
    tags: ["display driver", "led", "seven segment", "through hole", "dip"],
    searchTerms: ["max7219", "max7219cng", "led display driver", "7 segment driver", "seven segment"],
  },
];

const ELECTRONICS_TERMS = new Set([
  "arduino",
  "capacitor",
  "component",
  "components",
  "connector",
  "digikey",
  "diode",
  "electronics",
  "header",
  "ic",
  "led",
  "microcontroller",
  "mosfet",
  "op",
  "part",
  "resistor",
  "sensor",
  "switch",
  "timer",
  "transistor",
]);

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u00d7\u2715]/g, "x")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[-_/+.,()]+/g, " ")
    .replace(/[^a-z0-9.#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function singularize(token: string) {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function queryTokens(query: string) {
  const normalized = normalizeSearchText(query);
  const rawTokens = normalized.split(" ").filter((token) => token.length > 1 && token !== "x");
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    tokens.add(token);
    tokens.add(singularize(token));
  }
  const compact = compactSearchText(query);
  const compactMatches =
    compact.match(
      /(lm358|ne555|atmega328p|attiny85|esp32|2n3904|2n3906|1n4148|1n4007|irlz44n|l7805|rc0[68]05fr0710kl|cl10b104|grm188|b3f1000|mcp23017|pca9685|ds18b20|uln2803|74hc595|max7219)/g,
    ) ?? [];
  for (const token of compactMatches) tokens.add(token);
  return Array.from(tokens);
}

function itemSearchText(item: DigiKeyCatalogItem) {
  return [
    item.manufacturerPartNumber,
    item.digiKeyPartNumber,
    item.title,
    item.description,
    item.manufacturer,
    item.packaging,
    item.sourcePriceDisplay,
    ...item.tags,
    ...item.searchTerms,
  ].join(" ");
}

export function digikeyPartNumberFromText(text: string | null | undefined) {
  if (!text) return null;
  const compact = compactSearchText(text);
  for (const item of DIGIKEY_CATALOG) {
    const manufacturer = compactSearchText(item.manufacturerPartNumber);
    const digiKey = compactSearchText(item.digiKeyPartNumber);
    if (manufacturer && compact.includes(manufacturer)) return item.manufacturerPartNumber;
    if (digiKey && compact.includes(digiKey)) return item.manufacturerPartNumber;
  }
  return null;
}

export function isDigiKeyCatalogQuery(query: string) {
  const partNumber = digikeyPartNumberFromText(query);
  if (partNumber) return true;
  return queryTokens(query).some((token) => ELECTRONICS_TERMS.has(token));
}

export function findDigiKeyCatalogItem(params: {
  partNumber?: string | null;
  query?: string | null;
  url?: string | null;
}) {
  const explicitPartNumber =
    params.partNumber ?? digikeyPartNumberFromText(params.url) ?? digikeyPartNumberFromText(params.query);
  if (explicitPartNumber) {
    const compactPartNumber = compactSearchText(explicitPartNumber);
    const match = DIGIKEY_CATALOG.find(
      (item) =>
        compactSearchText(item.manufacturerPartNumber) === compactPartNumber ||
        compactSearchText(item.digiKeyPartNumber) === compactPartNumber,
    );
    if (match) return match;
  }
  if (!params.query) return null;
  return searchDigiKeyCatalog(params.query, 1)[0] ?? null;
}

export function searchDigiKeyCatalog(query: string, limit = 8) {
  if (!isDigiKeyCatalogQuery(query)) return [];

  const tokens = queryTokens(query);
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);

  return DIGIKEY_CATALOG.map((item) => {
    const itemText = itemSearchText(item);
    const normalizedItem = normalizeSearchText(itemText);
    const compactItem = compactSearchText(itemText);
    const itemWords = new Set(normalizedItem.split(" "));
    let score = 0;

    if (compactQuery.includes(compactSearchText(item.manufacturerPartNumber))) score += 120;
    if (compactQuery.includes(compactSearchText(item.digiKeyPartNumber))) score += 120;

    for (const token of tokens) {
      if (itemWords.has(token)) {
        score += ELECTRONICS_TERMS.has(token) ? 8 : 14;
      } else if (/[a-z]/.test(token) && /\d/.test(token) && compactItem.includes(token)) {
        score += 20;
      }
    }

    if (normalizedQuery.includes("digikey") || normalizedQuery.includes("digi key")) score += 5;
    if (normalizedQuery.includes("op amp") && normalizedItem.includes("op amp")) score += 14;
    if (normalizedQuery.includes("10k") && normalizedItem.includes("10 kohm")) score += 14;
    if (normalizedQuery.includes("0.1uf") && normalizedItem.includes("0.1 uf")) score += 14;
    if (normalizedQuery.includes("100nf") && normalizedItem.includes("0.1 uf")) score += 14;

    return { item, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.item);
}

export function applyDigiKeySafetyMargin(cents: number) {
  return Math.ceil((cents * (10_000 + DIGIKEY_SAFETY_MARGIN_BPS)) / 10_000);
}

export function priceDigiKeyCatalogItem(
  item: DigiKeyCatalogItem,
  requestedQuantity = 1,
): PricedDigiKeyCatalogItem {
  const normalizedQuantity = Number.isFinite(requestedQuantity)
    ? Math.max(1, Math.trunc(requestedQuantity))
    : 1;
  const sortedBreaks = [...item.priceBreaks].sort((left, right) => right.quantity - left.quantity);
  const selectedBreak =
    sortedBreaks.find((entry) => normalizedQuantity >= entry.quantity) ??
    sortedBreaks[sortedBreaks.length - 1];
  const sourceTotalCents = Math.max(
    1,
    Math.round((selectedBreak.unitPriceMicros * normalizedQuantity) / 10_000),
  );
  return {
    item,
    requestedQuantity: normalizedQuantity,
    selectedBreak,
    sourceTotalCents,
    totalCents: applyDigiKeySafetyMargin(sourceTotalCents),
  };
}
