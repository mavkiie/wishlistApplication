const path = require("path");
const http = require('http');
const express = require("express");  //express 
const bodyParser = require("body-parser"); //body parser for post
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb"); //for mongodb
const app = express();  
const portNumber = 5000;
const router  = express.Router(); 
//commented out for render
// require("dotenv").config({
//     path: path.resolve(__dirname, "credentials/.env"),
//  });
//MULTER: FOR IMAGES
const multer = require('multer');

// Define storage for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // e.g., 12345678.png
  }
});


const upload = multer({ storage: storage });
app.use(express.static(path.join(__dirname, "public")));
///////////

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING,
    { serverApi: ServerApiVersion.v1 });
async function getColl() {
    if (!client.topology) await client.connect();
        const db = client.db(process.env.MONGO_DB_NAME);
    return db.collection(process.env.MONGO_COLLECTION);
}

app.set("view engine", "ejs"); //sets the template user to ejs
app.set("views", path.resolve(__dirname, "templates"));
//body parser comes before the router
app.use(bodyParser.urlencoded({extended:false})); //body parser
app.use("/", router);

//displays index page (USES ROUTER!)
router.get("/", (req, res) => {
  res.render("index");          // same page you already have
});
//displays index page
app.get("/createWishlist", (req, res) => {

	res.render("createWishlist");
});


// POST /createWishlist  (server)
app.post("/createWishlist", async (req, res, next) => {
    try {
      const { title, description } = req.body;
  
      const id = encodeURIComponent(
                    title.trim().toLowerCase().replace(/\s+/g, "-"));
  
      const coll = await getColl();
      await coll.insertOne({
        title,
        id,                
        description,
        items: [],
        createdAt: new Date()
      });
  
      res.redirect(`/createWishlist/${id}/addItems`);
    } catch (err) { next(err); }
  });
  
app.get("/createWishlist/:id/addItems", async (req, res, next) => {
  try {
    const coll = await getColl();
    const wl = await coll.findOne({ id: req.params.id }); // ✅ use custom string id

    if (!wl) return res.status(404).send("Wishlist not found");

    res.render("addItems", {
      wishlist: wl,
    });
  } catch (err) {
    next(err);
  }
});

//processes ADD TO WISHLIST
app.post("/createWishlist/:id/processAddToWishlist", upload.single('itemImage'), async (req, res, next) => {
  try {
    const { name, price, store, category, priority, currency } = req.body;
    const id = req.params.id;
    const coll = await getColl();

    let convertedPrice = parseFloat(price);
    let exchangeInfo = "";

    if (currency !== "USD") {
      const res = await fetch(`https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/latest/USD`);
      const data = await res.json();
      const rate = data?.conversion_rates?.[currency]; // target currency
      if (rate) {
        convertedPrice = convertedPrice * rate; // USD → foreign
        exchangeInfo = `$${price} USD converted to ${convertedPrice.toFixed(2)} ${currency}`;
      } else {
        throw new Error(`Conversion rate for ${currency} not found.`);
      }
    }

    //file path (relative to public folder)
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    //update wishlist with new item
    await coll.updateOne(
      { id: id },
      { $push: {
          items: {
            name,
            store,
            originalPrice: price,
            convertedPrice,
            category,
            priority,
            currency,
            exchangeInfo,
            imagePath
          }
        }
      }
    );

     res.render("processAddToWishlist", {  //or the filename you are using
      name,
      price: convertedPrice.toFixed(2),
      store,
      category,
      priority,
      imagePath,
      exchangeInfo,
      wishlistTitle: id,
    });
  } catch (err) {
    next(err);
  }
});
//revisits a wishlist (gets page)
app.get("/revisitWishlist", (req, res) => {
  res.render("revisitWishlist");

});

app.post("/processRevisitWishlist", async (req, res) => { 
  const { wishlistName } = req.body;

  try {
    const coll = await getColl();
    const wishlist = await coll.findOne({ title: wishlistName });

    if (!wishlist) {
      return res.send("Wishlist not found.");
    }

    //construct HTML table of items
    let wishlistTable = `<h2 id="revisit-wishlist-title">${wishlist.title}</h2><p id="revisit-wishlist-desc">${wishlist.description}</p>`;
    wishlistTable += `<table><thead><tr><th>Item Name</th><th>Price (${wishlist.items[0].currency})</th><th>Store</th><th>Image</th></tr></thead><tbody>`;

    wishlist.items.forEach(item => {
      wishlistTable += `<tr>
        <td>${item.name}</td>
        <td>$${parseFloat(item.convertedPrice).toFixed(2)} </td>
        <td>${item.store}</td>
        <td><img class="image-styling" src="${item.imagePath}" width="100" alt="Item Image"/></td>
      </tr>`;
    });

    wishlistTable += `</tbody></table>`;

    const variable = {
      wishlistTable,
      wishlistTitle: wishlist.id,
    };

    res.render("processRevisitWishlist", variable);

  } catch (e) {
    console.error(e);
    res.status(500).send("Something went wrong.");
  }
});

app.post("/processDeleteWishlist", async (req, res) => {
  const { wishlistName } = req.body; // this is the id, not the display title

  try {
    const coll = await getColl();

    // First, find the wishlist so you can get the actual title
    const wishlist = await coll.findOne({ id: wishlistName });

    if (!wishlist) {
      return res.send("Wishlist not found.");
    }

    // Then delete it
    const result = await coll.deleteOne({ id: wishlistName });

    const variables = {
      wishlistName: wishlist.title, // use the display-friendly title
    };

    res.render("processDeleteWishlist", variables);

  } catch (e) {
    console.error(e);
    res.status(500).send("Error deleting wishlist.");
  }
});

//revisits a wishlist (gets page) (USES ROUTER!)
router.get("/getTotalOfWishlist", (req, res) => {
  res.render("getTotalOfWishlist");

});

//revisits a wishlist (gets page)
router.post("/processGetTotal", async (req, res) => {
  const {wishlistName} = req.body;

  try {
    const coll = await getColl();
    //gets wishlist
    const wl = await coll.findOne({title: wishlistName});

    if (!wl) {
      return res.send("Wishlist not found.");
    }
    let total = 0;
    let currencyType;

    wl.items.forEach(item => {
      total += item.convertedPrice;
      currencyType = item.currency;
    });
    const variables = { wishlistTotal: total,
                        wishlistTitle: wishlistName,
                        currencyType: currencyType,
                         
    };
    res.render("processGetTotal", variables);

  } catch (e) {
    console.error(e);
    res.status(500).send("Something went wrong.");
  }
  

});

//revisits a wishlist (gets page)
app.get("/deleteAllWishlists", (req, res) => {
  res.render("deleteAllWishlists");

});

//revisits a wishlist (gets page)
app.post("/processDeleteAllWishlists", async (req, res) => {
  try {
    const coll = await getColl();
    const filter = {}
    const result = await coll.deleteMany(filter);  //deletes all
    res.render("processDeleteAllWishlists");
  } catch (e) {
    console.error(e);
    res.status(500).send("Something went wrong.");
  }
  

});
//search wishlist items by category
app.get("/searchByCategory", (req, res) => {
  res.render("searchByCategory");

});

app.post("/processSearchByCategory", async (req, res) => {
  const { categoryName } = req.body;

  try {
    const coll = await getColl();

    const result = await coll.aggregate([
      { $unwind: "$items" },
      { $match: { "items.category": categoryName } }, // exact match
      {
        $project: {
          _id: 0,
          wishlistTitle: "$title", // include wishlist name
          name: "$items.name",
          price: "$items.convertedPrice",
          store: "$items.store",
          category: "$items.category",
          currency: "$items.currency",
          imagePath: "$items.imagePath",
        }
      }
    ]).toArray();

    const currency = result.length > 0 ? result[0].currency : "N/A"; // fallback if empty

    res.render("processSearchByCategory", {
      items: result,
      categoryName: categoryName,
      currency,
    });

  } catch (e) {
    console.error(e);
    res.status(500).send("Something went wrong.");
  }
});

//THIS WORKS! It runs the server based on the port number passed in
console.log(`Web server is running at http://localhost:${portNumber}`);
process.stdout.write("Stop to shut down server: ");
process.stdin.setEncoding("utf8");
//process.stdin listens to full lines
process.stdin.on("data", (input) => {
    const command = input.trim();
    if (command === "stop") {
        console.log("Shutting down the server");
        process.exit(0);
    } else{
        //makes sure it always reprompts
        process.stdout.write("Stop to shut down server: ");
    }
});

app.listen(portNumber);


