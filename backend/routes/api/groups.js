// backend/routes/api/groups.js
const e = require("express");
const express = require("express");
const {
	Group,
	Membership,
	GroupImage,
	Event,
	Attendance,
	EventImage,
	User,
	Venue
} = require("../../db/models");
const { check } = require("express-validator");
const { Op } = require("sequelize");
const { restoreUser, requireAuth } = require("../../utils/auth");
const { handleValidationErrors } = require("../../utils/validation");

const router = express.Router();

const validateCreateGroup = [
	check("name")
		.exists({ checkFalsy: true })
		.isLength({ max: 60 })
		.withMessage("Name must be 60 characters or less"),
	check("about")
		.exists({ checkFalsy: true })
		.isLength({ min: 50 })
		.withMessage("About must be 50 characters or more"),
	check("type")
		.exists({ checkFalsy: true })
		.isIn(["Online", "In person"])
		.withMessage("Type must be 'Online' or 'In person'"),
	check("private")
		.exists({ checkNull: true })
		.isBoolean({ loose: false })
		.withMessage("Private must be a boolean"),
	check("city").exists({ checkFalsy: true }).withMessage("City is required"),
	check("state").exists({ checkFalsy: true }).withMessage("State is required"),
	handleValidationErrors
];

const validateEditGroup = [
	check("name")
		.isLength({ max: 60 })
		.withMessage("Name must be 60 characters or less"),
	check("about")
		.isLength({ min: 50 })
		.withMessage("About must be 50 characters or more"),
	check("type")
		.isIn(["Online", "In person"])
		.withMessage("Type must be 'Online' or 'In person'"),
	check("private")
		.isBoolean({ loose: false })
		.withMessage("Private must be a boolean"),
	handleValidationErrors
];
// Get all groups created by or joined by current user
router.get("/current", restoreUser, async (req, res, next) => {
	const userId = req.user.id;
	const userJoinedGroups = await Group.findAll({
		include: {
			model: Membership,
			where: {
				userId
			},
			attributes: []
		},
		raw: true
	});
	const userOrganizedGroups = await Group.findAll({
		where: {
			organizerId: userId
		},
		raw: true
	});
	const Groups = userJoinedGroups.concat(userOrganizedGroups);

	for (let group of Groups) {
		group.numMembers = await Membership.count({
			where: {
				groupId: group.id
			}
		});
		const previewImage = await GroupImage.findOne({
			where: {
				[Op.and]: [{ preview: true }, { groupId: group.id }]
			},
			attributes: ["url"]
		});
		group.previewImage = previewImage.url;
	}

	res.json({ Groups });
});

// Get details of a group based on its ID
router.get("/:groupId", async (req, res, next) => {
	const { groupId } = req.params;
	let groupDetails = await Group.findByPk(groupId, {
		include: [
			{
				model: GroupImage
			},
			{
				model: User,
				as: "Organizer",
				attributes: ["id", "firstName", "lastName"]
			},
			{
				model: Venue
			}
		]
	});
	if (groupDetails) {
		groupDetails = groupDetails.toJSON();
		const numMembers = await Membership.count({
			where: {
				groupId
			}
		});
		groupDetails.numMembers = numMembers;
		res.json(groupDetails);
	} else {
		const err = new Error("Group couldn't be found");
		err.status = 404;
		next(err);
	}
});

// Get all groups, include aggregate data for number of members in each group, and the groups preview image url
router.get("/", async (req, res, next) => {
	const Groups = await Group.findAll({
		raw: true
	});
	for (let group of Groups) {
		group.numMembers = await Membership.count({
			where: {
				groupId: group.id
			}
		});
		if (!group.numMembers) group.numMembers = 0;
		const previewImage = await GroupImage.findOne({
			where: {
				[Op.and]: [{ preview: true }, { groupId: group.id }]
			},
			attributes: ["url"]
		});
		if (group.previewImage) {
			group.previewImage = previewImage.url;
		} else {
			group.previewImage = null;
		}
	}
	res.json({ Groups });
});

// Create an image for a group
router.post("/:groupId/images", async (req, res, next) => {
	const { groupId } = req.params;
	if (!req.user) {
		const err = new Error("Authentication required");
		err.status = 401;
		next(err);
	}
	const groupToAddImageTo = await Group.findByPk(groupId);
	if (!groupToAddImageTo) {
		const err = new Error("Group couldn't be found");
		err.status = 404;
		next(err);
	} else if (req.user.id !== groupToAddImageTo.organizerId) {
		const err = new Error("Forbidden");
		err.status = 403;
		next(err);
	}
	const { url, preview } = req.body;
	const newGroupImage = await GroupImage.create({
		groupId,
		url,
		preview
	});
	const { id } = newGroupImage;

	res.json({ id, url, preview });
});

// Create a new group
router.post("/", validateCreateGroup, async (req, res, next) => {
	if (!req.user) {
		const err = new Error("Authentication required");
		err.status = 401;
		next(err);
	} else {
		const { name, about, type, private, city, state } = req.body;
		const newGroup = await Group.create({
			organizerId: req.user.id,
			name,
			about,
			type,
			private,
			city,
			state
		});
		res.json(newGroup);
	}
});

// Edit a group
router.put("/:groupId", validateEditGroup, async (req, res, next) => {
	const { groupId } = req.params;
	const { name, about, type, private, city, state } = req.body;
	if (!req.user) {
		const err = new Error("Authentication required");
		err.status = 401;
		next(err);
	}
	const groupToEdit = await Group.findByPk(groupId);
	if (!groupToEdit) {
		const err = new Error("Group couldn't be found");
		err.status = 404;
		return next(err);
	} else if (req.user.id !== groupToEdit.organizerId) {
		const err = new Error("Forbidden");
		err.status = 403;
		next(err);
	}
	if (name) groupToEdit.name = name;
	if (about) groupToEdit.about = about;
	if (type) groupToEdit.type = type;
	if (private) groupToEdit.private = private;
	if (city) groupToEdit.city = city;
	if (state) groupToEdit.state = state;
	await groupToEdit.save();
	res.json(groupToEdit);
});

// Error handler for when Group cannot be found by id, or authentication is required
router.use((err, _req, res, next) => {
	const errors = [
		"Group couldn't be found",
		"Authentication required",
		"Forbidden"
	];
	if (errors.includes(err.message)) {
		res.status(err.status);
		res.json({
			message: err.message,
			statusCode: err.status
		});
	} else {
		next(err);
	}
});

module.exports = router;
