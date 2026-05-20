import {
    createHostelService
} from "./hostels.service.js";

/*
=================================================
CREATE HOSTEL
=================================================
*/

export const createHostelController =
async (req, res) => {

    try {

        const { name } =
            req.body;

        const hostel =
            await createHostelService(
                name
            );

        res.status(200).json({
            success: true,
            hostel
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};