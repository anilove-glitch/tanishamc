import dotenv from "dotenv";
import app from "./src/app.js";

dotenv.config();

/*
=================================================
PORT
=================================================
*/

const PORT = process.env.PORT || 3000;

/*
=================================================
START SERVER
=================================================
*/

app.listen(PORT, () => {
    console.log(
        `Server running on port ${PORT}`
    );
});