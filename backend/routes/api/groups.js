// backend/routes/api/groups.js
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
const { Op } = require("sequelize");
const {
	requireAuthentication,
	requireAuthorization,
	checkIfMembershipExists,
	checkIfGroupExists,
	requireOrganizerOrCoHost,
	requireOrganizerOrCoHostOrIsUser,
	checkIfMembershipDoesNotExist
} = require("../../utils/auth");
const {
	validateCreateGroup,
	validateEditGroup,
	validateCreateGroupVenue
} = require("../../utils/validation-chains");
const { notFound } = require("../../utils/not-found");
const {
	checkForValidStatus,
	checkIfUserDoesNotExist
} = require("../../utils/validation");

const router = express.Router();

// Get all members of a group by group id
router.get("/:groupId/members", async (req, res, next) => {
	const { groupId } = req.params;
	const isOrganizer = await Group.findOne({
		attributes: ["organizerId"],
		where: {
			[Op.and]: [{ organizerId: req.user.id }, { id: groupId }]
		}
	});
	console.log(isOrganizer, req.user.id);
	let where = {};
	if (!isOrganizer) {
		where = {
			status: {
				[Op.ne]: "pending"
			}
		};
	}
	const group = await Group.findByPk(groupId, {
		attributes: [],
		include: {
			model: User,
			as: "Members",
			through: {
				attributes: {
					exclude: ["userId", "groupId", "createdAt", "updatedAt"]
				},
				where
			},
			attributes: {
				exclude: [
					"username",
					"email",
					"hashedPassword",
					"createdAt",
					"updatedAt"
				]
			}
		}
	});

	if (!group) {
		return next(notFound("Group couldn't be found"));
	}

	res.json(group);
});

// Get all venues for a Group specified by its id
router.get(
	"/:groupId/venues",
	requireAuthentication,
	async (req, res, next) => {
		const { groupId } = req.params;
		const group = await Group.findByPk(groupId);
		if (!group) {
			return next(notFound("Group couldn't be found"));
		}
		const userMembership = await Membership.findOne({
			where: {
				[Op.and]: [{ userId: req.user.id }, { groupId }]
			}
		});
		if (
			(userMembership && userMembership.status === "co-host") ||
			group.organizerId === req.user.id
		) {
			const Venues = await Venue.findAll({
				where: {
					groupId
				}
			});
			res.json({ Venues });
		}
		return next(requireAuthorization());
	}
);

// Get all groups created by or joined by current user
router.get("/current", requireAuthentication, async (req, res, next) => {
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
		console.log("hello");
		if (group && previewImage) {
			group.previewImage = previewImage.url;
		} else {
			group.previewImage = null;
		}
		if (group.private === 0) group.private = false;
		if (group.private === 1) group.private = true;
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
		if (groupDetails.private === 0) groupDetails.private = false;
		if (groupDetails.private === 1) groupDetails.private = true;
		res.json(groupDetails);
	} else {
		next(notFound("Group couldn't be found"));
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
		if (group && previewImage) {
			group.previewImage = previewImage.url;
		} else {
			group.previewImage = null;
		}
		if (group.private === 0) group.private = false;
		if (group.private === 1) group.private = true;
	}
	return res.json({ Groups });
});

// Request membership for a group by group id
router.post(
	"/:groupId/membership",
	requireAuthentication,
	checkIfMembershipExists,
	checkIfGroupExists,
	async (req, res, next) => {
		const userId = req.user.id;
		const { groupId } = req.params;

		const newMember = await Membership.create({
			userId,
			groupId,
			status: "pending"
		});

		const resBody = {
			memberId: userId,
			status: newMember.status
		};

		return res.json(resBody);
	}
);

// Create an image for a group
router.post(
	"/:groupId/images",
	requireAuthentication,
	async (req, res, next) => {
		const { groupId } = req.params;
		const groupToAddImageTo = await Group.findByPk(groupId);
		if (!groupToAddImageTo) {
			return next(notFound("Group couldn't be found"));
		} else if (req.user.id !== groupToAddImageTo.organizerId) {
			return next(requireAuthorization());
		}
		const { url, preview } = req.body;
		const newGroupImage = await GroupImage.create({
			groupId,
			url,
			preview
		});
		const { id } = newGroupImage;

		res.json({ id, url, preview });
	}
);

// Create a new group
router.post(
	"/",
	requireAuthentication,
	validateCreateGroup,
	async (req, res, next) => {
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
);

// Create a new venue for a group
router.post(
	"/:groupId/venues",
	requireAuthentication,
	validateCreateGroupVenue,
	async (req, res, next) => {
		const { groupId } = req.params;
		const group = await Group.findByPk(groupId);
		if (!group) {
			return next(notFound("Group couldn't be found"));
		}
		const userMembership = await Membership.findOne({
			where: {
				[Op.and]: [{ userId: req.user.id }, { groupId }]
			}
		});
		if (
			(userMembership && userMembership.status === "co-host") ||
			group.organizerId === req.user.id
		) {
			const { address, city, state, lat, lng } = req.body;
			const newVenue = await Venue.create({
				groupId,
				address,
				city,
				state,
				lat,
				lng
			});
			const { id } = newVenue;
			return res.json({ id, groupId, address, city, state, lat, lng });
		}
		return next(requireAuthorization());
	}
);

// Edit a group
router.put(
	"/:groupId",
	requireAuthentication,
	validateEditGroup,
	async (req, res, next) => {
		const { groupId } = req.params;
		const { name, about, type, private, city, state } = req.body;

		const groupToEdit = await Group.findByPk(groupId);
		if (!groupToEdit) {
			return next(notFound("Group couldn't be found"));
		} else if (req.user.id !== groupToEdit.organizerId) {
			return next(requireAuthorization());
		}

		if (name) groupToEdit.name = name;
		if (about) groupToEdit.about = about;
		if (type) groupToEdit.type = type;
		if (private) groupToEdit.private = private;
		if (city) groupToEdit.city = city;
		if (state) groupToEdit.state = state;
		await groupToEdit.save();
		res.json(groupToEdit);
	}
);

// Change membership status by group id (memberId located in req.body)
router.put(
	"/:groupId/membership",
	requireAuthentication,
	checkIfGroupExists,
	requireOrganizerOrCoHost,
	checkForValidStatus,
	async (req, res, next) => {
		const { groupId } = req.params;
		const { memberId, status } = req.body;

		const membershipToChange = await Membership.findOne({
			where: { [Op.and]: [{ userId: memberId }, { groupId }] }
		});

		membershipToChange.status = status;
		await membershipToChange.save();
		return res.json({
			id: membershipToChange.id,
			groupId: +groupId,
			memberId,
			status
		});
	}
);

// Delete a group
router.delete("/:groupId", requireAuthentication, async (req, res, next) => {
	const { groupId } = req.params;
	const groupToDelete = await Group.findByPk(groupId);
	if (!groupToDelete) {
		return next(notFound("Group couldn't be found"));
	}
	if (groupToDelete.organizerId !== req.user.id) {
		return next(requireAuthorization());
	}
	await groupToDelete.destroy();
	return res.json({
		message: "Successfully deleted",
		statusCode: 200
	});
});

// Delete a member
router.delete(
	"/:groupId/membership",
	requireAuthentication,
	checkIfGroupExists,
	checkIfUserDoesNotExist,
	checkIfMembershipDoesNotExist,
	requireOrganizerOrCoHostOrIsUser,
	async (req, res, next) => {
		const { memberId } = req.body;
		const { groupId } = req.params;

		const memberToDelete = await Membership.findOne({
			where: { [Op.and]: [{ userId: memberId }, { groupId }] }
		});

		await memberToDelete.destroy();

		return res.json({
			message: "Successfully deleted membership from group"
		});
	}
);

module.exports = router;
