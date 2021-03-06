require('dotenv/config');
const express = require('express');

const db = require('./database');
const ClientError = require('./client-error');
const staticMiddleware = require('./static-middleware');
const sessionMiddleware = require('./session-middleware');

const app = express();

app.use(staticMiddleware);
app.use(sessionMiddleware);

app.use(express.json());

app.get('/api/health-check', (req, res, next) => {
  db.query('select \'successfully connected\' as "message"')
    .then(result => res.json(result.rows[0]))
    .catch(err => next(err));
});

app.get('/api/products', (req, res, next) => {
  const allProducts = `
    select "productId",
           "name",
           "price",
           "image",
           "shortDescription"
    from "products"
  `;
  db.query(allProducts)
    .then(result => {
      const products = result.rows;
      res.json(products);
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({
        error: 'An unexpected error occured'
      });
    });
});

app.get('/api/products/:productId', (req, res, next) => {
  const productId = parseInt(req.params.productId, 10);
  const params = [productId];

  const productDetails = `
    select *
    from "products"
    where "productId" = $1
  `;

  db.query(productDetails, params)
    .then(result => {
      const product = result.rows[0];
      if (product) {
        return res.json(product);
      } else {
        throw new ClientError(`cant find product with productId ${productId}`, 404);
      }
    })
    .catch(err => next(err));
});

app.get('/api/cart', (req, res, next) => {
  const cartId = req.session.cartId;
  if (!req.session.cartId) {
    return res.json([]);
  } else {
    const sql = `
      select "c"."cartItemId",
       "c"."price",
       "p"."productId",
       "p"."image",
       "p"."name",
       "p"."shortDescription"
       from "cartItems" as "c"
       join "products" as "p" using ("productId")
      where "c"."cartId" = $1
    `;
    const params = [cartId];
    db.query(sql, params)
      .then(result => {
        return res.json(result.rows);
      })
      .catch(err => next(err));
  }
});

app.post('/api/cart', (req, res, next) => {
  const productId = parseInt(req.body.productId, 10);
  const params = [productId];

  const sql = `
    select "price"
    from "products"
    where "productId" = $1
  `;

  if (!Number.isInteger(productId) || productId <= 0) {
    throw new ClientError('productId must be a positive integer', 404);
  }
  db.query(sql, params)
    .then(result => {
      if (!result.rows) {
        throw new ClientError('No results available at this moment', 400);
      } else {
        if (req.session.cartId) {
          return {
            cartId: req.session.cartId,
            price: result.rows[0].price
          };
        } else {
          const addToCart = `
          insert into "carts" ("cartId", "createdAt")
          values (default, default)
          returning "cartId"
          `;
          return db.query(addToCart)
            .then(result1 => {
              return {
                cartId: result1.rows[0].cartId,
                price: result.rows[0].price
              };
            });
        }
      }
    })
    .then(data => {
      req.session.cartId = data.cartId;
      const sql = `
        insert into "cartItems" ("cartId", "productId", "price")
        values ($1, $2, $3)
        returning "cartItemId"
      `;

      const params = [data.cartId, parseInt(req.body.productId, 10), data.price];
      return (
        db.query(sql, params)
          .then(result => result.rows[0])
      );
    })
    .then(result => {
      const sql = `
        select "c"."cartItemId",
      "c"."price",
      "p"."productId",
      "p"."image",
      "p"."name",
      "p"."shortDescription"
      from "cartItems" as "c"
      join "products" as "p" using ("productId")
      where "c"."cartItemId" = $1
      `;
      const params = [result.cartItemId];
      return db.query(sql, params)
        .then(result => {
          res.status(201).json(result.rows[0]);
        });
    })
    .catch(err => next(err));
});

app.post('/api/orders', (req, res, next) => {
  const cartId = req.session.cartId;
  const name = req.body.name;
  const creditCard = req.body.creditCard;
  const shippingAddress = req.body.shippingAddress;

  const params = [cartId, name, creditCard, shippingAddress];
  const sql = `
    insert into "orders" ("cartId", "name", "creditCard", "shippingAddress")
    values ($1, $2, $3, $4)
    returning "orderId","createdAt", "name", "creditCard", "shippingAddress"
  `;
  if (!cartId) {
    throw new ClientError('cartId not found', 400);
  }

  if (!name || !creditCard || !shippingAddress) {
    throw new ClientError('You are missing order information', 400);
  }

  return db.query(sql, params)
    .then(result => {
      const order = result.rows[0];
      delete req.session.cartId;
      res.status(201).json(order);
    })
    .catch(err => next(err));
});

app.use('/api', (req, res, next) => {
  next(new ClientError(`cannot ${req.method} ${req.originalUrl}`, 404));
});

app.use((err, req, res, next) => {
  if (err instanceof ClientError) {
    res.status(err.status).json({ error: err.message });
  } else {
    console.error(err);
    res.status(500).json({
      error: 'an unexpected error occurred'
    });
  }
});

app.listen(process.env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log('Listening on port', process.env.PORT);
});
