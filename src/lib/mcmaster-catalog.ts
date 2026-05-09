export type McMasterCatalogItem = {
  partNumber: string;
  title: string;
  description: string;
  url: string;
  unitOfMeasure: string;
  packageQuantity: number;
  sourcePriceCents: number;
  sourcePriceDisplay: string;
  verifiedAt: string;
  tags: string[];
  searchTerms: string[];
};

export type PricedMcMasterCatalogItem = {
  item: McMasterCatalogItem;
  requestedQuantity: number;
  packageCount: number;
  sourceTotalCents: number;
  packagePriceCents: number;
  totalCents: number;
};

export const MCMASTER_SAFETY_MARGIN_BPS = 500;
export const MCMASTER_CATALOG_VERIFIED_AT = "2026-05-08";

// Visible McMaster-Carr package prices verified from rendered product/order-info
// pages on 2026-05-08. Quote helpers add the 5% safety margin at runtime.
export const MCMASTER_CATALOG: McMasterCatalogItem[] = [
  {
    partNumber: "91292A110",
    title: "M3 x 5 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A110/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 654,
    sourcePriceDisplay: "$6.54 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 5 mm", "m3x5", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A111",
    title: "M3 x 6 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A111/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1271,
    sourcePriceDisplay: "$12.71 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 6 mm", "m3x6", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A112",
    title: "M3 x 8 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A112/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 594,
    sourcePriceDisplay: "$5.94 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 8 mm", "m3x8", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A113",
    title: "M3 x 10 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A113/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 654,
    sourcePriceDisplay: "$6.54 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 10 mm", "m3x10", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A114",
    title: "M3 x 12 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A114/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 654,
    sourcePriceDisplay: "$6.54 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 12 mm", "m3x12", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A115",
    title: "M3 x 16 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A115/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 773,
    sourcePriceDisplay: "$7.73 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 16 mm", "m3x16", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A123",
    title: "M3 x 20 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A123/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 891,
    sourcePriceDisplay: "$8.91 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 screw", "m3 screws", "m3 x 20 mm", "m3x20", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A116",
    title: "M4 x 10 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A116/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 951,
    sourcePriceDisplay: "$9.51 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 screw", "m4 screws", "m4 x 10 mm", "m4x10", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A117",
    title: "M4 x 12 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A117/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 951,
    sourcePriceDisplay: "$9.51 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 screw", "m4 screws", "m4 x 12 mm", "m4x12", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A118",
    title: "M4 x 16 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A118/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1070,
    sourcePriceDisplay: "$10.70 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 screw", "m4 screws", "m4 x 16 mm", "m4x16", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A121",
    title: "M4 x 20 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A121/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1189,
    sourcePriceDisplay: "$11.89 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 screw", "m4 screws", "m4 x 20 mm", "m4x20", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A122",
    title: "M4 x 25 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A122/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1307,
    sourcePriceDisplay: "$13.07 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 screw", "m4 screws", "m4 x 25 mm", "m4x25", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A124",
    title: "M5 x 10 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A124/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1211,
    sourcePriceDisplay: "$12.11 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m5", "stainless", "fasteners"],
    searchTerms: ["m5 screw", "m5 screws", "m5 x 10 mm", "m5x10", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "91292A125",
    title: "M5 x 12 mm 18-8 stainless socket head screws",
    description: "DIN 912 / ISO 4762 metric socket head cap screws; pack of 100.",
    url: "https://www.mcmaster.com/91292A125/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1376,
    sourcePriceDisplay: "$13.76 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["screws", "socket head", "m5", "stainless", "fasteners"],
    searchTerms: ["m5 screw", "m5 screws", "m5 x 12 mm", "m5x12", "socket head cap screw", "18-8 stainless", "din 912", "iso 4762"],
  },
  {
    partNumber: "93475A210",
    title: "M3 18-8 stainless general purpose washers",
    description: "DIN 125 / ISO 7089 flat washers, 3.2 mm ID and 7 mm OD; pack of 100.",
    url: "https://www.mcmaster.com/93475A210/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 241,
    sourcePriceDisplay: "$2.41 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["washers", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 washer", "m3 washers", "m3 flat washer", "3.2 mm id", "7 mm od", "18-8 stainless", "din 125", "iso 7089"],
  },
  {
    partNumber: "93475A230",
    title: "M4 18-8 stainless general purpose washers",
    description: "DIN 125 / ISO 7089 flat washers, 4.3 mm ID and 9 mm OD; pack of 100.",
    url: "https://www.mcmaster.com/93475A230/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 393,
    sourcePriceDisplay: "$3.93 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["washers", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 washer", "m4 washers", "m4 flat washer", "4.3 mm id", "9 mm od", "18-8 stainless", "din 125", "iso 7089"],
  },
  {
    partNumber: "93475A240",
    title: "M5 18-8 stainless general purpose washers",
    description: "DIN 125 / ISO 7089 flat washers, 5.3 mm ID and 10 mm OD; pack of 100.",
    url: "https://www.mcmaster.com/93475A240/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 387,
    sourcePriceDisplay: "$3.87 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["washers", "m5", "stainless", "fasteners"],
    searchTerms: ["m5 washer", "m5 washers", "m5 flat washer", "5.3 mm id", "10 mm od", "18-8 stainless", "din 125", "iso 7089"],
  },
  {
    partNumber: "93475A250",
    title: "M6 18-8 stainless general purpose washers",
    description: "DIN 125 / ISO 7089 flat washers, 6.4 mm ID and 12 mm OD; pack of 100.",
    url: "https://www.mcmaster.com/93475A250/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 705,
    sourcePriceDisplay: "$7.05 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["washers", "m6", "stainless", "fasteners"],
    searchTerms: ["m6 washer", "m6 washers", "m6 flat washer", "6.4 mm id", "12 mm od", "18-8 stainless", "din 125", "iso 7089"],
  },
  {
    partNumber: "92148A150",
    title: "M3 18-8 stainless split lock washers",
    description: "Split lock washers for M3 screw size, 3.4 mm ID and 6.2 mm OD; pack of 100.",
    url: "https://www.mcmaster.com/92148A150/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 192,
    sourcePriceDisplay: "$1.92 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["lock washers", "washers", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 lock washer", "m3 lock washers", "split lock washer", "3.4 mm id", "6.2 mm od", "18-8 stainless"],
  },
  {
    partNumber: "91828A211",
    title: "M3 18-8 stainless hex nuts",
    description: "Corrosion-resistant standard-profile hex nuts, M3 x 0.5 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/91828A211/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 520,
    sourcePriceDisplay: "$5.20 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["nuts", "hex nuts", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 nut", "m3 nuts", "m3 hex nut", "m3 x 0.5 nut", "18-8 stainless", "din 934"],
  },
  {
    partNumber: "91828A231",
    title: "M4 18-8 stainless hex nuts",
    description: "Corrosion-resistant standard-profile hex nuts, M4 x 0.7 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/91828A231/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 725,
    sourcePriceDisplay: "$7.25 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["nuts", "hex nuts", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 nut", "m4 nuts", "m4 hex nut", "m4 x 0.7 nut", "18-8 stainless", "din 934"],
  },
  {
    partNumber: "91828A241",
    title: "M5 18-8 stainless hex nuts",
    description: "Corrosion-resistant standard-profile hex nuts, M5 x 0.8 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/91828A241/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 977,
    sourcePriceDisplay: "$9.77 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["nuts", "hex nuts", "m5", "stainless", "fasteners"],
    searchTerms: ["m5 nut", "m5 nuts", "m5 hex nut", "m5 x 0.8 nut", "18-8 stainless", "din 934"],
  },
  {
    partNumber: "91828A251",
    title: "M6 18-8 stainless hex nuts",
    description: "Corrosion-resistant standard-profile hex nuts, M6 x 1 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/91828A251/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 1525,
    sourcePriceDisplay: "$15.25 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["nuts", "hex nuts", "m6", "stainless", "fasteners"],
    searchTerms: ["m6 nut", "m6 nuts", "m6 hex nut", "m6 x 1 nut", "18-8 stainless", "din 934"],
  },
  {
    partNumber: "90576A102",
    title: "M3 zinc-plated steel nylon-insert locknuts",
    description: "Class 8 medium-strength nylon-insert locknuts, M3 x 0.5 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/90576A102/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 555,
    sourcePriceDisplay: "$5.55 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["locknuts", "nuts", "m3", "zinc plated", "fasteners"],
    searchTerms: ["m3 locknut", "m3 locknuts", "m3 nylon insert nut", "nylon insert locknut", "m3 x 0.5 nut", "zinc plated"],
  },
  {
    partNumber: "90576A103",
    title: "M4 zinc-plated steel nylon-insert locknuts",
    description: "Class 8 medium-strength nylon-insert locknuts, M4 x 0.7 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/90576A103/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 668,
    sourcePriceDisplay: "$6.68 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["locknuts", "nuts", "m4", "zinc plated", "fasteners"],
    searchTerms: ["m4 locknut", "m4 locknuts", "m4 nylon insert nut", "nylon insert locknut", "m4 x 0.7 nut", "zinc plated"],
  },
  {
    partNumber: "90576A104",
    title: "M5 zinc-plated steel nylon-insert locknuts",
    description: "Class 8 medium-strength nylon-insert locknuts, M5 x 0.8 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/90576A104/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 404,
    sourcePriceDisplay: "$4.04 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["locknuts", "nuts", "m5", "zinc plated", "fasteners"],
    searchTerms: ["m5 locknut", "m5 locknuts", "m5 nylon insert nut", "nylon insert locknut", "m5 x 0.8 nut", "zinc plated"],
  },
  {
    partNumber: "90923A216",
    title: "M3 18-8 stainless locknuts with external-tooth washer",
    description: "Stainless locknuts with attached external-tooth lock washer, M3 x 0.5 mm thread; pack of 50.",
    url: "https://www.mcmaster.com/90923A216/",
    unitOfMeasure: "Pack of 50",
    packageQuantity: 50,
    sourcePriceCents: 1379,
    sourcePriceDisplay: "$13.79 per pack of 50",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["locknuts", "nuts", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 locknut", "m3 locknuts", "external tooth lock washer", "keps nut", "m3 x 0.5 nut", "18-8 stainless"],
  },
  {
    partNumber: "90923A219",
    title: "M4 18-8 stainless locknuts with external-tooth washer",
    description: "Stainless locknuts with attached external-tooth lock washer, M4 x 0.7 mm thread; pack of 50.",
    url: "https://www.mcmaster.com/90923A219/",
    unitOfMeasure: "Pack of 50",
    packageQuantity: 50,
    sourcePriceCents: 1241,
    sourcePriceDisplay: "$12.41 per pack of 50",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["locknuts", "nuts", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 locknut", "m4 locknuts", "external tooth lock washer", "keps nut", "m4 x 0.7 nut", "18-8 stainless"],
  },
  {
    partNumber: "93033A107",
    title: "M3 18-8 stainless flange nuts",
    description: "Standard-profile flange nuts, M3 x 0.5 mm thread; pack of 100.",
    url: "https://www.mcmaster.com/93033A107/",
    unitOfMeasure: "Pack of 100",
    packageQuantity: 100,
    sourcePriceCents: 770,
    sourcePriceDisplay: "$7.70 per pack of 100",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["flange nuts", "nuts", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 flange nut", "m3 flange nuts", "m3 x 0.5 nut", "18-8 stainless"],
  },
  {
    partNumber: "93033A105",
    title: "M4 18-8 stainless flange nuts",
    description: "Standard-profile flange nuts, M4 x 0.7 mm thread; pack of 50.",
    url: "https://www.mcmaster.com/93033A105/",
    unitOfMeasure: "Pack of 50",
    packageQuantity: 50,
    sourcePriceCents: 1029,
    sourcePriceDisplay: "$10.29 per pack of 50",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["flange nuts", "nuts", "m4", "stainless", "fasteners"],
    searchTerms: ["m4 flange nut", "m4 flange nuts", "m4 x 0.7 nut", "18-8 stainless"],
  },
  {
    partNumber: "94000A330",
    title: "M3 18-8 stainless cap nuts",
    description: "DIN 1587 cap nuts, M3 x 0.5 mm thread; pack of 10.",
    url: "https://www.mcmaster.com/94000A330/",
    unitOfMeasure: "Pack of 10",
    packageQuantity: 10,
    sourcePriceCents: 468,
    sourcePriceDisplay: "$4.68 per pack of 10",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["cap nuts", "nuts", "m3", "stainless", "fasteners"],
    searchTerms: ["m3 cap nut", "m3 cap nuts", "acorn nut", "m3 x 0.5 nut", "18-8 stainless", "din 1587"],
  },
  {
    partNumber: "99437A130",
    title: "M3 zinc-plated steel hex press-fit nuts",
    description: "Press-fit nuts for sheet metal, M3 x 0.5 mm thread, for 1 mm minimum panel thickness; pack of 25.",
    url: "https://www.mcmaster.com/99437A130/",
    unitOfMeasure: "Pack of 25",
    packageQuantity: 25,
    sourcePriceCents: 981,
    sourcePriceDisplay: "$9.81 per pack of 25",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["press-fit nuts", "nuts", "m3", "sheet metal", "fasteners"],
    searchTerms: ["m3 press fit nut", "m3 press-fit nut", "m3 sheet metal nut", "pem nut", "m3 x 0.5 nut", "zinc plated"],
  },
  {
    partNumber: "96439A490",
    title: "M3 18-8 stainless round press-fit nuts",
    description: "Press-fit nuts for sheet metal, M3 x 0.5 mm thread, for 0.8 mm minimum panel thickness; pack of 25.",
    url: "https://www.mcmaster.com/96439A490/",
    unitOfMeasure: "Pack of 25",
    packageQuantity: 25,
    sourcePriceCents: 810,
    sourcePriceDisplay: "$8.10 per pack of 25",
    verifiedAt: MCMASTER_CATALOG_VERIFIED_AT,
    tags: ["press-fit nuts", "nuts", "m3", "sheet metal", "stainless", "fasteners"],
    searchTerms: ["m3 press fit nut", "m3 press-fit nut", "m3 sheet metal nut", "pem nut", "m3 x 0.5 nut", "18-8 stainless"],
  },
];

const HARDWARE_TERMS = new Set([
  "bolt",
  "bolts",
  "cap",
  "fastener",
  "fasteners",
  "flange",
  "hardware",
  "locknut",
  "locknuts",
  "m3",
  "m4",
  "m5",
  "m6",
  "mcmaster",
  "nut",
  "nuts",
  "screw",
  "screws",
  "socket",
  "stainless",
  "washer",
  "washers",
]);

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u00d7\u2715]/g, "x")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[-_/]+/g, " ")
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
  const compactMatches = compact.match(/m[0-9](?:x[0-9]+)?/g) ?? [];
  for (const token of compactMatches) tokens.add(token);
  return Array.from(tokens);
}

function itemSearchText(item: McMasterCatalogItem) {
  return [
    item.partNumber,
    item.title,
    item.description,
    item.unitOfMeasure,
    item.sourcePriceDisplay,
    ...item.tags,
    ...item.searchTerms,
  ].join(" ");
}

export function mcmasterPartNumberFromText(text: string | null | undefined) {
  if (!text) return null;
  const match = text.toUpperCase().match(/\b\d{4,6}[A-Z]\d{2,4}\b/);
  return match?.[0] ?? null;
}

export function isMcMasterCatalogQuery(query: string) {
  const partNumber = mcmasterPartNumberFromText(query);
  if (partNumber) return true;
  return queryTokens(query).some((token) => HARDWARE_TERMS.has(token));
}

export function findMcMasterCatalogItem(params: {
  partNumber?: string | null;
  query?: string | null;
  url?: string | null;
}) {
  const explicitPartNumber =
    params.partNumber ?? mcmasterPartNumberFromText(params.url) ?? mcmasterPartNumberFromText(params.query);
  if (explicitPartNumber) {
    const match = MCMASTER_CATALOG.find((item) => item.partNumber === explicitPartNumber.toUpperCase());
    if (match) return match;
  }
  if (!params.query) return null;
  return searchMcMasterCatalog(params.query, 1)[0] ?? null;
}

export function searchMcMasterCatalog(query: string, limit = 8) {
  if (!isMcMasterCatalogQuery(query)) return [];

  const tokens = queryTokens(query);
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);

  return MCMASTER_CATALOG.map((item) => {
    const normalizedItem = normalizeSearchText(itemSearchText(item));
    const compactItem = compactSearchText(itemSearchText(item));
    const itemWords = new Set(normalizedItem.split(" "));
    let score = 0;

    if (normalizedQuery.includes(item.partNumber.toLowerCase())) score += 100;
    if (compactQuery.includes(item.partNumber.toLowerCase())) score += 100;

    for (const token of tokens) {
      if (itemWords.has(token)) {
        score += HARDWARE_TERMS.has(token) ? 10 : 14;
      } else if (/[a-z]/.test(token) && /\d/.test(token) && compactItem.includes(token)) {
        score += 18;
      }
    }

    if (normalizedQuery.includes("mcmaster")) score += 5;
    if (normalizedQuery.includes("socket head") && normalizedItem.includes("socket head")) score += 12;
    if (normalizedQuery.includes("lock washer") && normalizedItem.includes("lock washer")) score += 12;
    if (normalizedQuery.includes("press fit") && normalizedItem.includes("press fit")) score += 12;
    if (normalizedQuery.includes("press-fit") && normalizedItem.includes("press fit")) score += 12;

    return { item, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.sourcePriceCents - b.item.sourcePriceCents)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.item);
}

export function applyMcMasterSafetyMargin(cents: number) {
  return Math.ceil((cents * (10_000 + MCMASTER_SAFETY_MARGIN_BPS)) / 10_000);
}

export function priceMcMasterCatalogItem(
  item: McMasterCatalogItem,
  requestedQuantity = 1,
): PricedMcMasterCatalogItem {
  const normalizedQuantity = Number.isFinite(requestedQuantity)
    ? Math.max(1, Math.trunc(requestedQuantity))
    : 1;
  const packageCount = Math.max(1, Math.ceil(normalizedQuantity / item.packageQuantity));
  const packagePriceCents = applyMcMasterSafetyMargin(item.sourcePriceCents);
  return {
    item,
    requestedQuantity: normalizedQuantity,
    packageCount,
    sourceTotalCents: item.sourcePriceCents * packageCount,
    packagePriceCents,
    totalCents: packagePriceCents * packageCount,
  };
}
