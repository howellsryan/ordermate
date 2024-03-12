using Microsoft.AspNetCore.Mvc;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly ILogger<OrdersController> _logger;
    private readonly IOrderService _orderService;

    public OrdersController(ILogger<OrdersController> logger, IOrderService orderService)
    {
        _logger = logger;
        _orderService = orderService;
    }

    [HttpGet("{orderNumber}")]
    public async Task<ActionResult<OrderModel>> Get(string orderNumber)
    {
        try
        {
            var order = await _orderService.GetByOrderNumber(orderNumber);

            return Ok(order);
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpPost("Create")]
    public async Task<ActionResult> Create([FromBody] string email, int storeId)
    {
        try
        {
            await _orderService.Create(email, storeId);

            return Ok();
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpPost("AddItem")]
    public async Task<ActionResult> AddItem([FromBody] AddOrderItemModel orderItemModel)
    {
        try
        {
            await _orderService.AddItem(orderItemModel);

            return Ok();
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpPost("UpdateItem")]
    public async Task<ActionResult> UpdateItem([FromBody] AddOrderItemModel orderItemModel)
    {
        try
        {
            await _orderService.UpdateItem(orderItemModel);

            return Ok();
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpPost("RemoveItem")]
    public async Task<ActionResult> RemoveItem([FromBody] int orderItemId)
    {
        try
        {
            await _orderService.RemoveItem(orderItemId);

            return Ok();
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }
}