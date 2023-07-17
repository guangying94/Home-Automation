import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
const CosmosClient = require("@azure/cosmos").CosmosClient;

const endpoint = process.env["COSMOS_ENDPOINT"];
const key = process.env["COSMOS_KEY"];
const databaseId = process.env["COSMOS_DATABASE"];
const containerId = process.env["COSMOS_CONTAINER"];
const busArrivalBaseURL = process.env["BUS_ARRIVAL_BASE_URL"];
const LTA_API_KEY = process.env["LTA_API_KEY"];

interface BusArrivalDetails {
  BusStopCode: string;
  Description: string;
  BusDetails: BusArrivalResponse[];
}

interface BusArrivalResponse {
  ServiceNo: string;
  ArrivalTimeInMinutes: number[];
}

export async function BusArrival(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const client = new CosmosClient({ endpoint, key });
  const database = client.database(databaseId);
  const container = database.container(containerId);

  const lon = request.query.get("lon") || "";
  const lat = request.query.get("lat") || "";
  const range = request.query.get("range") || "";

  if (lon === "" || lat === "" || range === "") {
    return { status: 400, body: "Bad Request" };
  }

  //context.log(`Http function processed request for url "${request.url}"`);

  const querySpec = {
    query: `SELECT c.BusStopCode, c.Description, ROUND(ST_DISTANCE({"type": "Point", "coordinates":[c.Longitude, c.Latitude]}, {"type": "Point", "coordinates":[${lon}, ${lat}]}),2) AS Range FROM c WHERE ST_DISTANCE({"type": "Point", "coordinates":[c.Longitude, c.Latitude]}, {"type": "Point", "coordinates":[${lon}, ${lat}]}) < ${range}`,
  };

  const { resources: items } = await container.items
    .query(querySpec)
    .fetchAll();

  // sort items by Range
  items.sort((a: any, b: any) => {
    return a.Range - b.Range;
  });

  // create a new object with BusArrivalDetails
  const busArrivalDetails: BusArrivalDetails[] = [];

  // get bus arrival details, by calling Bus arrival base url, with BusStopCode, using fetch. add headers to fetch request. the header is AccountKey, with value 'LTA_API_KEY'
  // parse the response to json, and get the BusArrivalResponse array from the json response
  // create a new object with BusArrivalDetails, and add the BusArrivalResponse array to the BusDetails property
  // for bus arrival timing, get the EstimatedArrival property, and convert it to minutes for NextBus, NextBus2 and NextBus3. Place the results in minute as array

  async function getBusArrivalDetails(item: any) {
    const response = await fetch(
      `${busArrivalBaseURL}?BusStopCode=${item.BusStopCode}`,
      {
        headers: {
          AccountKey: LTA_API_KEY,
        },
      }
    );
    const json = await response.json();
    const busArrivalResponse: BusArrivalResponse[] = [];
    json.Services.forEach((service: any) => {
      const busArrival: BusArrivalResponse = {
        ServiceNo: service.ServiceNo,
        ArrivalTimeInMinutes: [
          Math.round(
            (new Date(service.NextBus.EstimatedArrival).getTime() -
              new Date().getTime()) /
              60000
          ),
          Math.round(
            (new Date(service.NextBus2.EstimatedArrival).getTime() -
              new Date().getTime()) /
              60000
          ),
          Math.round(
            (new Date(service.NextBus3.EstimatedArrival).getTime() -
              new Date().getTime()) /
              60000
          ),
        ],
      };
      busArrivalResponse.push(busArrival);
    });

    const busArrivalDetailsItem: BusArrivalDetails = {
      BusStopCode: item.BusStopCode,
      Description: item.Description,
      BusDetails: busArrivalResponse,
    };

    busArrivalDetails.push(busArrivalDetailsItem);
  }

  for (const item of items) {
    await getBusArrivalDetails(item);
  }

  return {
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(busArrivalDetails),
  };
}

app.http("BusArrival", {
  methods: ["GET"],
  authLevel: "function",
  handler: BusArrival,
});
